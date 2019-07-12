import * as UICallbacks from './ui_callbacks.js';
import * as Utils from './utils.js';
import AppData from './app_data.js';

class UI {
    constructor() {
        this.type = 'still';
        this.touchStart = 0;
        this.touchEnd = 0;
        this.hls = new Hls();

        const player = document.getElementById('videoPanel');
        this.hls.attachMedia(player);

        document.getElementById('videoPanel').style.display = 'none';
        document.getElementById('imagePanel').onload = Utils.hideLoadingModal;

        this.touchBegin = this.touchBegin.bind(this);
        this.touchFinish = this.touchFinish.bind(this);
        this.resize = this.resize.bind(this);
    }

    setupVideoQuality() {
        const player = document.getElementById('videoPanel');
        // Force a quality drop when seeking to a new part of the video for quicker seeks.
        const lowQualityOnSeek = Utils.isMobile() ? AppData.isLowQualityOnLoadEnabledForMobile() : AppData.isLowQualityOnLoadEnabled();
        if (lowQualityOnSeek) {
            player.addEventListener('seeking', () => {
                console.log('Seeking - Forcing to level 0');
                // Only has in effect if the segment isn't already loaded.
                this.hls.nextLoadLevel = 0;
            });
        }
    }

    setVideo(hash) {
        const autoPlay = !Utils.isMobile() && AppData.isAutoplayEnabled();
        const url = `/cache/${hash}/index.m3u8`;
        const player = document.getElementById('videoPanel');
        player.poster = autoPlay ? '#' : `/cache/thumbnails/${hash}.png`;

        this.hls.detachMedia();
        const lowQualityOnSeek = Utils.isMobile() ? AppData.isLowQualityOnLoadEnabledForMobile() : AppData.isLowQualityOnLoadEnabled();
        const options = {
            autoStartLoad: false,
            capLevelToPlayerSize: true
        };
        if (lowQualityOnSeek) {
            options.startLevel = 0;
        }
        this.hls = new Hls(options);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (autoPlay) {
                player.play();
            }
            Utils.hideLoadingModal();

            const levels = this.hls.levels.map((el) => {
                return `${el.height}p`;
            });

            console.log('Manifest parsed - Quality Levels', levels);
        });

        this.hls.on(Hls.Events.LEVEL_SWITCHING, (event, data) => {
            console.log(`Quality level switching to: ${data.height}p`);
        });

        this.hls.attachMedia(player);

        this.hls.loadSource(url);
        if (autoPlay) {
            this.hls.startLoad();
        } else {
            const hls = this.hls;
            function loadListener() {
                hls.startLoad();
                player.removeEventListener('play', loadListener);
            }
            player.addEventListener('play', loadListener);
        }
    }

    setType(image) {
        const imagePanel = document.getElementById('imagePanel');
        const videoPanel = document.getElementById('videoPanel');
        const type = image.type;

        imagePanel.src = '#';
        videoPanel.poster = '#';
        if (!videoPanel.paused) {
            videoPanel.pause();
        }

        if (this.type != type) {
            videoPanel.style.display = 'none';
            imagePanel.style.display = 'none';
        }

        if (type == 'video') {
            videoPanel.style.display = 'block';
            this.setVideo(AppData.currentImage.hash);
        } else if (type == 'gif' || type == 'still') {
            // A bug in Firefox seems to be preventing the rendering when
            // loading is complete only when src is updated. This can be worked
            // around by replacing the node.
            const clone = imagePanel.cloneNode(true);
            const parent = imagePanel.parentNode;
            parent.removeChild(imagePanel);
            parent.appendChild(clone);

            Utils.showLoadingModal();
            clone.style.display = 'block';
            clone.src = `/api/images/${AppData.currentImage.hash}/file`;
        }
        this.type = type;
    }

    updateTitle() {
        document.title = `Vimtur [${AppData.imageSet.current + 1}/${AppData.getMap().length}] (${Utils.getImageTitle(AppData.currentImage)})`;
    }

    updateImage() {
        Utils.err(async () => {
            this.setType(AppData.currentImage);
            Utils.setDisplayedRating(AppData.currentImage.rating);
        }, 'Error getting new media');
    }

    next() {
        if (Utils.isGalleryVisible()) {
            AppData.galleryNext();
        } else {
            AppData.next();
        }
    }

    previous() {
        if (Utils.isGalleryVisible()) {
            AppData.galleryPrevious();
        } else {
            AppData.previous();
        }
    }

    touchBegin(e) {
        const touchobj = e.changedTouches[0]; // reference first touch point (ie: first finger)
        this.touchX = Number(touchobj.clientX); // get x position of touch point relative to left edge of browser
    }

    touchFinish(e) {
        const touchobj = e.changedTouches[0]; // reference first touch point for this event
        this.touchDistance = Number(touchobj.clientX) - this.touchX;
        if (this.touchDistance < -100) {
            AppData.next();
            e.preventDefault();
        } else if (this.touchDistance > 100) {
            AppData.previous();
            e.preventDefault();
        }
    }

    resize() {
        const navBar = document.getElementById('navBar');
        const content = document.getElementById('mainContainer');
        content.style['padding-top'] = `${navBar.offsetHeight}px`;
        if (Utils.isTagsVisible() && window.innerWidth < Utils.MIN_WIDTH_TAG_PANEL) {
            Utils.toggleTags();
        }
    }
}

class Gallery {
    constructor() {
        // Propagate the gallery with 15 more containers from the template.
        const galleryTemplate = document.getElementById('thumbContainer0');
        const container = document.getElementById('galleryRowContainer');
        for (let i = 1; i < Utils.GALLERY_COUNT; i++) {
            const thumb = galleryTemplate.cloneNode(true);
            thumb.id = `thumbContainer${i}`;
            thumb.children[0].children[0].id = `thumb${i}`;
            thumb.children[0].children[1].id = `thumbCaption${i}`;
            container.appendChild(thumb);
        }
    }

    update() {
        const pageNum = document.getElementById('galleryPageNumber');
        // Round offset down to the correct page.
        const pagedOffset = Math.floor(AppData.imageSet.galleryOffset / Utils.GALLERY_COUNT) * Utils.GALLERY_COUNT;
        pageNum.innerHTML = `${Math.floor(pagedOffset / Utils.GALLERY_COUNT) + 1} of ${Math.ceil(AppData.getMap().length / Utils.GALLERY_COUNT)}`;
        for (let i = 0; i < Utils.GALLERY_COUNT; i++) {
            Utils.err(async () => {
                const thumbnail = document.getElementById(`thumb${i}`);
                const caption = document.getElementById(`thumbCaption${i}`);
                const url = thumbnail.parentNode;

                url.title = '';
                thumbnail.src = '#';
                caption.innerHTML = '';
                thumbnail.style.display = 'none';

                const index = pagedOffset + i;

                if (index >= AppData.getMap().length) {
                    url.onclick = function() {};
                } else {
                    const hash = AppData.getMap()[index];
                    const media = await Utils.request(`/api/images/${hash}`);

                    thumbnail.onload = () => {
                        thumbnail.style.display = 'block';
                        url.title = Utils.getImageTitle(media);
                        switch (media.type) {
                        case 'video':
                            caption.innerHTML = 'Video';
                            break;
                        case 'gif':
                            caption.innerHTML = 'Gif';
                            break;
                        case 'still':
                            caption.innerHTML = 'Still';
                            break;
                        default:
                            caption.innerHTML = '';
                            break;
                        }
                    };

                    thumbnail.src = `/cache/thumbnails/${hash}.png`;
                    url.onclick = function() {
                        AppData.goto(hash);
                        $('#galleryModal').modal('hide');
                    };
                }
            });
        }
    }
}

(async function() {
    $('#loadingModal').modal('show');
    // Setup callbacks
    Object.assign(window, UICallbacks);

    const ui = new UI();
    const gallery = new Gallery();

    document.onresize = ui.resize;

    window.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName.toLowerCase() == 'textarea') {
            return;
        }
        if (document.activeElement.tagName.toLowerCase() == 'input') {
            if (document.activeElement.type != 'checkbox') {
                return;
            }
        }
        if (e.key == 'ArrowRight') {
            ui.next();
        } else if (e.key == 'ArrowLeft') {
            ui.previous();
        } else if (e.key == 'Delete') {
            UICallbacks.deleteCurrent();
        }
    }, false);

    document.body.addEventListener('touchstart', ui.touchBegin, false);
    document.body.addEventListener('touchend', ui.touchFinish, false);

    AppData.on('message', (data) => {
        console.log(data);
        Utils.showMessage(data);
    });

    AppData.on('scanStatus', () => {
        const statusArea = document.getElementById('adminStatusArea');
        statusArea.value = Utils.formatAdminStatus(AppData.scanStatus);
    });

    AppData.on('title', () => {
        ui.updateTitle();
    });

    AppData.on('change', () => {
        if (AppData.currentImage) {
            ui.updateImage();
        } else {
            Utils.showMessage('No media added. Click Import to begin');
            Utils.showModal('#adminModal');
        }
    });

    AppData.on('tags', (redraw) => {
        if (redraw) {
            Utils.setTags(AppData.tags, async (tag, state) => {
                await Utils.err(async () => {
                    if (state) {
                        await AppData.addMediaTag(tag, AppData.currentImage.hash);
                    } else {
                        await AppData.removeMediaTag(tag, AppData.currentImage.hash);
                    }
                }, 'Error saving tag state');
            });
            // Fire actors redraw so the width is correctly shown
            AppData.fire('actors', true);
            Utils.buildSearch(AppData.tags);
        }
        if (AppData.currentImage) {
            Utils.setChecked(AppData.tags, AppData.currentImage.tags);
        }
    });

    AppData.on('actors', (redraw) => {
        if (redraw) {
            const actors = [];
            for (let i = 0; i < AppData.actors.length; i++) {
                actors.push({
                    id: AppData.actors[i],
                    text: AppData.actors[i]
                });
            }

            $('#actorsList').select2({
                width: 'resolve',
                data: actors,
                tags: true
            }).change();
            $('#actorsList').val(AppData.actors).change();
            $('.actorsMetadata').select2({
                width: 'resolve',
                data: actors,
                tags: true
            }).change();
        }
        if (AppData.currentImage) {
            $('.actorsMetadata').val(AppData.currentImage.actors).trigger('change');
        }
    });

    AppData.on('gallery', () => {
        gallery.update();
    });

    AppData.on('state', (stateUrl) => {
        $('#stateUrlField').val(stateUrl);
    });

    // Fetch config, tags etc from the server.
    try {
        await AppData.fetchAll();
    } catch (err) {
        console.log(`Invalid config (${err.message}), redirecting to setup...`, err);
    }

    // Already one existing column.
    const colCount = AppData.getColumnCount();
    for (let i = AppData.DEFAULT_COLUMN_COUNT; i < colCount; i++) {
        UICallbacks.addTagColumn();
    }
    AppData.fire('tags', true);

    $('#actorsList').on('select2:select', async (e) => {
        const actor = e.params.data.text.trim();
        if (!actor) {
            return;
        }
        console.log(`Adding actor ${actor}`);
        const result = await Utils.BootBox.confirm(`Are you sure you want to create ${actor}?`);
        if (!result) {
            return;
        }
        await AppData.addActor(actor);
    });

    $('#actorsList').on('select2:unselect', async (e) => {
        const actor = e.params.data.text.trim();
        if (!actor) {
            return;
        }
        console.log(`Removing actor ${actor}`);
        const result = await Utils.BootBox.confirm(`Are you sure you want to delete ${actor}?`);
        if (!result) {
            return;
        }
        await AppData.removeActor(actor);
    });

    $('.actorsMetadata').on('select2:select', async (e) => {
        const actor = e.params.data.text.trim();
        if (!actor) {
            return;
        }
        const hash = AppData.currentImage.hash;
        console.log(`Adding actor ${actor} to ${hash}`);
        if (!AppData.actors.includes(actor)) {
            const result = await Utils.BootBox.confirm(`Are you sure you want to create ${actor}?`);
            if (!result) {
                return;
            }
        }
        await AppData.addActor(actor, hash);
    });

    $('.actorsMetadata').on('select2:unselect', async (e) => {
        const actor = e.params.data.text.trim();
        if (!actor) {
            return;
        }
        console.log(`Removing actor ${actor} from ${AppData.currentImage.hash}`);
        await AppData.removeActor(actor, AppData.currentImage.hash);
    });

    for (let i = 1; i <= 5; i++) {
        $(`.rating-${i}`).hover(() => {
            Utils.setDisplayedRating(i, true);
            $(`.rating-${i}`).addClass('rating-hover');
        }, () => {
            Utils.setDisplayedRating(0, true);
        });
        $(`.rating-${i}`).click(() => {
            Utils.setDisplayedRating(i);
            Utils.err(async () => {
                await AppData.update(AppData.currentImage.hash, { rating: i });
            }, 'Failed to update rating');
        });
    }

    $('#autoplayCheckbox').prop('checked', AppData.isAutoplayEnabled());
    $('#stateCheckbox').prop('checked', AppData.isStateEnabled());
    $('#enableLowQualityOnLoad').prop('checked', AppData.isLowQualityOnLoadEnabled());
    $('#enableLowQualityOnLoadForMobile').prop('checked', AppData.isLowQualityOnLoadEnabledForMobile());

    ui.resize();
    ui.setupVideoQuality();
    Utils.hideLoadingModal();

    if (AppData.imageSet.map.length == 0) {
        Utils.showMessage('No media found. Click \'Import\' in the admin panel');
        Utils.showModal('#adminModal');
    }
})();
