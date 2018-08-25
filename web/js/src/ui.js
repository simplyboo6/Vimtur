import AppData from './app_data.js';
import * as UICallbacks from './ui_callbacks.js';
import * as Utils from './utils.js';

class UI {
    constructor() {
        Object.assign(this, {
            imagePanel: document.getElementById("imagePanel"),
            videoPanel: document.getElementById("videoPanel"),
            hls: new Hls(),
            type: "still",
            touchStart: 0,
            touchEnd: 0
        });
        this.hls.attachMedia(this.videoPanel);
        this.imagePanel.onload = Utils.hideLoadingModal;

        this.touchBegin = this.touchBegin.bind(this);
        this.touchFinish = this.touchFinish.bind(this);
        this.resize = this.resize.bind(this);
    }

    setType(image) {
        let type = image.type;
        this.imagePanel.src = '#';
    
        if (this.type != type) {
            this.videoPanel.style.display = 'none';
            this.imagePanel.style.display = 'none';
        }
    
        if (type == 'video') {
            $(this.videoPanel).attr("poster", "");
            const autoplay = !Utils.isMobile() && AppData.isAutoplayEnabled();
            this.hls.detachMedia();
            this.hls = new Hls({ autoStartLoad: false });
            const $this = this;
            this.hls.on(Hls.Events.MANIFEST_PARSED, function() {
                if (autoplay) {
                    $this.videoPanel.play();
                }
                Utils.hideLoadingModal();
            });
            this.hls.attachMedia(this.videoPanel);
            this.videoPanel.style.display = 'block';
            // Only show the poster if not autoplay. If it's enabled then it'll only flash
            // for a moment and that looks weird. (Assuming a reasonable connection)
            if (!autoplay) {
                $(this.videoPanel).attr("poster", `/cache/thumbnails/${AppData.currentImage.hash}.png`);
            }
            this.hls.loadSource(`/cache/${AppData.currentImage.hash}/index.m3u8`);
            if (autoplay) {
                $this.hls.startLoad();
            } else {
                function loadListener() {
                    $this.hls.startLoad();
                    $this.videoPanel.removeEventListener('play', loadListener);
                }
                this.videoPanel.addEventListener('play', loadListener);
            }
        } else if (type == 'gif' || type == 'still') {
            Utils.showLoadingModal();
            this.imagePanel.style.display = 'block';
            this.imagePanel.src = `/api/images/${AppData.currentImage.hash}/file`;
        }
        this.type = type;
    }

    updateTitle() {
        document.title = `Vimtur [${AppData.imageSet.current + 1}/${AppData.getMap().length}] (${Utils.getImageTitle(AppData.currentImage)})`;
    }

    updateImage() {
        const $this = this;
        Utils.err(async function() {
            $this.videoPanel.pause();
            $this.setType(AppData.currentImage);
            Utils.setDisplayedRating(AppData.currentImage.rating);
        }, "Error getting new media");
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
        this.touchX = parseInt(touchobj.clientX); // get x position of touch point relative to left edge of browser
    }

    touchFinish(e) {
        const touchobj = e.changedTouches[0]; // reference first touch point for this event
        this.touchDistance = parseInt(touchobj.clientX) - this.touchX;
        if (this.touchDistance < -100) {
            AppData.next();
            e.preventDefault();
        } else if (this.touchDistance > 100) {
            AppData.previous();
            e.preventDefault();
        }
    }

    resize() {
        const navBar = document.getElementById("navBar");
        const content = document.getElementById("mainContainer");
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
        const pageNum = document.getElementById("galleryPageNumber");
        pageNum.innerHTML = `${Math.floor(AppData.imageSet.galleryOffset / Utils.GALLERY_COUNT) + 1} of ${Math.ceil(AppData.getMap().length / Utils.GALLERY_COUNT)}`;
        for (let i = 0; i < Utils.GALLERY_COUNT; i++) {
            const thumbnail = document.getElementById(`thumb${i}`);
            const caption = document.getElementById(`thumbCaption${i}`);
            console.log(caption);
            const url = thumbnail.parentNode;
            url.title = "";
            let index = AppData.imageSet.galleryOffset + i;
            if (index >= AppData.getMap().length) {
                url.onclick = function() {};
                thumbnail.style.display = 'none';
                caption.innerHTML = '';
            } else {
                const hash = AppData.getMap()[index];
                thumbnail.src = `/cache/thumbnails/${hash}.png`;
                thumbnail.style.display = 'block';
                url.onclick = function() {
                    AppData.goto(hash);
                    $('#galleryModal').modal('hide');
                }
    
                const promise = Utils.request(`/api/images/${hash}`);
                promise.catch(function(err) {
                    Utils.showMessage('Error updating media');
                    console.log(err);
                });
                promise.then(function(metadata) {
                    url.title = getImageTitle(metadata);
                    switch (metadata.type) {
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
                            caption.innerHTML = "";
                            break;
                    }
                });
            }
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
    
    window.addEventListener("keydown", function(e) {
        if (document.activeElement.tagName.toLowerCase() == 'textarea') {
            return;
        }
        if (document.activeElement.tagName.toLowerCase() == 'input') {
            if (document.activeElement.type != 'checkbox') {
                return;
            }
        }
        if (e.key == "ArrowRight") {
            ui.next();
        } else if (e.key == "ArrowLeft") {
            ui.previous();
        } else if (e.key == "Delete") {
            AppData.deleteCurrent();
        }
    }, false);

    document.body.addEventListener('touchstart', ui.touchBegin, false);
    document.body.addEventListener('touchend', ui.touchFinish, false);
    
    AppData.on('message', function (data) {
        console.log(data);
        Utils.showMessage(data);
    });
    
    AppData.on('scanStatus', function() {
        const statusArea = document.getElementById("adminStatusArea");
        statusArea.value = Utils.formatAdminStatus(AppData.scanStatus);
    });
    
    AppData.on('title', function() {
        ui.updateTitle();
    });
    
    AppData.on('change', function() {
        if (AppData.currentImage) {
            ui.updateImage();
        } else {
            Utils.showMessage('No media added. Click Import to begin');
            Utils.showModal('#adminModal');
        }
    });
    
    AppData.on('tags', function(redraw) {
        if (redraw) {
            Utils.setTags(AppData.tags, async function(tag, state) {
                await Utils.err(async function() {
                    if (state) {
                        await AppData.addTag(tag, AppData.currentImage.hash);
                    } else {
                        await AppData.removeTag(tag, AppData.currentImage.hash);
                    }
                }, "Error saving tag state");
            });
            Utils.buildSearch(AppData.tags);
        }
        if (AppData.currentImage) {
            Utils.setChecked(AppData.tags, AppData.currentImage.tags);
        }
    });
    
    AppData.on('actors', function(redraw) {
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
        $('.actorsMetadata').val(AppData.currentImage.actors).trigger('change');
    });
    
    AppData.on('gallery', function() {
        gallery.update();
    });
    
    // Fetch config, tags etc from the server.
    try {
        await AppData.fetchAll();
    } catch (err) {
        if (err.type && err.type === 'config') {
            console.log(`Invalid config (${err.message}), redirecting to setup...`);
            window.location.replace('/web/config.html');
            return;
        } else {
            console.log(err);
            Utils.showMessage(err.message);
        }
    }

    // Already one existing column.
    const colCount = AppData.getColumnCount();
    for (let i = AppData.DEFAULT_COLUMN_COUNT; i < colCount; i++) {
        UICallbacks.addTagColumn();
    }
    AppData.fire('tags', true);

    $('#actorsList').on('select2:select', async function (e) {
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

    $('#actorsList').on('select2:unselect', async function (e) {
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

    $('.actorsMetadata').on('select2:select', async function (e) {
        const actor = e.params.data.text.trim();
        if (!actor) {
            return;
        }
        console.log(`Adding actor ${actor} from ${AppData.currentImage.hash}`);
        if (!AppData.actors.includes(actor)) {
            const result = await Utils.BootBox.confirm(`Are you sure you want to create ${actor}?`);
            if (!result) {
                return;
            }
        }
        await AppData.addActor(actor, AppData.currentImage.hash);
    });

    $('.actorsMetadata').on('select2:unselect', async function (e) {
        const actor = e.params.data.text.trim();
        if (!actor) {
            return;
        }
        console.log(`Removing actor ${actor} from ${AppData.currentImage.hash}`);
        await AppData.removeActor(actor, appData.currentImage.hash);
    });

    for (let i = 1; i <= 5; i++) {
        $(`.rating-${i}`).hover(function() {
            Utils.setDisplayedRating(i, true)
            $(`.rating-${i}`).addClass('rating-hover');
        }, function() {
            Utils.setDisplayedRating(0, true);
        });
        $(`.rating-${i}`).click(function() {
            Utils.setDisplayedRating(i);
            Utils.err(async function() {
                await AppData.update(AppData.currentImage.hash, { rating: i });
            }, "Failed to update rating");
        });
    }

    $("#autoplayCheckbox").prop("checked", AppData.isAutoplayEnabled());

    ui.resize();
    Utils.hideLoadingModal();
})();
