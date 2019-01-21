import AppData from './app_data.js';
import * as Utils from './utils.js';

export async function deleteTag() {
    let result = await Utils.BootBox.prompt("Please enter the name of the tag to remove");
    if (result == null) {
        return;
    }
    if (!result) {
        Utils.showMessage('Tag name invalid');
        return;
    }
    if (!AppData.tags.includes(result)) {
        Utils.showMessage('Tag does not exist');
        return;
    }
    const confirmation = await Utils.BootBox.confirm(`Are you sure you want to remove the tag '${result}'. This is irreversible.`);
    if (confirmation) {
        await AppData.removeTag(result);
    }
}

export async function simpleSearch() {
    const text = document.getElementById("simpleSearchText").value;
    if (!text) {
        console.log("Search box empty");
        return false;
    }
    const constraints = {
        keywordSearch: text
    };
    Utils.showMessage("Running search...");
    await Utils.err(async() => {
        if (!(await AppData.getSubset(constraints))) {
            Utils.showMessage("No media matching search criteria");
        }
    }, "Error running search");
    return false;
}

export async function viewFolder() {
    await Utils.err(async function() {
        await AppData.getSubset({ folder: AppData.getMap()[AppData.imageSet.current] }, { preserve: true });
    }, "Error seaching for files in folder");
}

export async function goto() {
    let result = await Utils.BootBox.prompt("Please enter a hash or number");
    if (result != null) {
        AppData.goto(result);
    }
}

export function resetTagList() {
    AppData.fire('tags');
}

export async function search() {
    const constraints = {
        all: [],
        any: [],
        none: [],
        type: []
    };
    for (let i = 0; i < AppData.tags.length; i++) {
        const tag = AppData.tags[i];
        const all = document.getElementsByClassName(`allTag-${tag}`)[0];
        if (all.checked) {
            constraints.all.push(tag);
        }
        const any = document.getElementsByClassName(`anyTag-${tag}`)[0];
        if (any.checked) {
            constraints.any.push(tag);
        }
        const none = document.getElementsByClassName(`noneTag-${tag}`)[0];
        if (none.checked) {
            constraints.none.push(tag);
        }
    }
    if (document.getElementById("typeFilterVideo").checked) {
        constraints.type.push("video");
    }
    if (document.getElementById("typeFilterGif").checked) {
        constraints.type.push("gif");
    }
    if (document.getElementById("typeFilterStill").checked) {
        constraints.type.push("still");
    }
    const resolution = document.getElementById("resolutionSearch");
    switch (resolution.options[resolution.selectedIndex].text) {
        case "480p":
            constraints.width = 640;
            constraints.height = 480;
            break;
        case "720p":
            constraints.width = 1280;
            constraints.height = 720;
            break;
        case "1080p":
            constraints.width = 1920;
            constraints.height = 1080;
            break;
        default: break;
    }

    const minimumRatingElement = document.getElementById("ratingMinimum");
    const minimumRating = minimumRatingElement.options[minimumRatingElement.selectedIndex].text;
    if (minimumRating !== "None") {
        constraints.rating = {
            min: parseInt(minimumRating)
        };
    }

    const maximumRatingElement = document.getElementById("ratingMaximum");
    const maximumRating = maximumRatingElement.options[maximumRatingElement.selectedIndex].text;
    if (maximumRating !== "None") {
        constraints.rating = constraints.rating || {};
        if (maximumRating === "Unrated") {
            Object.assign(constraints.rating, {
                max: 0
            });
        } else {
            Object.assign(constraints.rating, {
                max: parseInt(maximumRating)
            });
        }
    }


    function setMap(elementName, varName) {
        const element = document.getElementById(elementName);
        if (element.value) {
            constraints[varName] = element.value;
        }
    }
    //setMap("artistLex", "artist");
    //setMap("albumLex", "album");
    //setMap("titleLex", "title");
    //setMap("tagsLex", "tagLexer");
    //setMap("pathLex", "path");
    //setMap("generalLex", "generalLexer");
    setMap("keywordSearch", "keywordSearch");
    //setMap("actorLex", "actorLexer");

    $('#searchModal').modal('hide');

    Utils.showMessage('Running search...');
    await Utils.err(async function() {
        if (!(await AppData.getSubset(constraints, { preserve: true }))) {
            Utils.showMessage('No search results found');
        }
    }, "Error running search");
}

export async function deleteCurrent() {
    const del = await Utils.BootBox.confirm(`Delete ${AppData.currentImage.path}?`);
    if (del === true) {
        await Utils.err(async function() {
            await AppData.deleteCurrent();
        }, "Error deleting current media");
    }
}

export function galleryPrevious() {
    AppData.galleryPrevious();
}

export function galleryNext() {
    AppData.galleryNext();
}

export function openGallery() {
    AppData.galleryGoto(AppData.imageSet.current);
}

export async function addNewTag() {
    let result = await Utils.BootBox.prompt("Please enter the new tags name");
    if (result == null) {
        return;
    }
    if (!result) {
        Utils.showMessage('New tag invalid');
        return;
    }
    try {
        await AppData.addTag(result);
        // Show the tags list if it's not visible
        toggleTags(true);
    } catch (err) {
        Utils.showMessage(`Error adding new tag ${result}`);
        console.log(err);
    }
}

export async function runScan() {
    await Utils.err(async function() {
        await AppData.scan();
    }, "Error starting scan");
}

export async function importNew() {
    const deleteClonesElement = document.getElementById("importDeleteClones");
    await Utils.err(async function() {
        await AppData.importNew(deleteClonesElement.checked);
    }, "Error starting import");
}

export async function fullImport() {
    const deleteClonesElement = document.getElementById("fullImportDeleteClones");
    await Utils.err(async function() {
        await AppData.importAll(deleteClonesElement.checked);
    }, "Error starting import");
}

export async function deleteMissing() {
    await Utils.err(async function() {
        await AppData.deleteMissing();
    }, "Error deleting missing files");
}

export async function runCache() {
    await Utils.err(async function() {
        await AppData.runCache();
    }, "Error starting caching");
}

export async function applyMetadata(type, multi) {
    const metadata = {};
    let value = "";
    switch (type) {
        case 'artist':
            metadata.artist = document.getElementById("artistMetadata").value;
            value = metadata.artist;
            break;
        case 'album':
            metadata.album = document.getElementById("albumMetadata").value;
            value = metadata.album;
            break;
        case 'title':
            metadata.title = document.getElementById("titleMetadata").value;
            value = metadata.title;
            break;
        default:
            return Utils.showMessage(`Error: Unknown metadata type ${type}`);

    }
    await Utils.err(async function() {
        if (multi) {
            const result = await Utils.BootBox.confirm(`Are you sure you want to apply '${value}' to ${type} on all ${AppData.getMap().length} images?`);
            if (result) {
                Utils.showMessage(`Applying '${value}' to ${type} for ${AppData.getMap().length} images`);
                $('#metadataModal').modal('hide');
                await AppData.updateSet(AppData.getMap(), {metadata})
                Utils.showMessage(`Metdata applied to ${map.length} images`);
            }
        } else {
            await AppData.update(AppData.currentImage.hash, {metadata});
            $('#metadataModal').modal('hide');
            Utils.showMessage("Metadata saved");
        }
    }, "Error saving metadata");
}

export function next() {
    AppData.next();
}

export function previous() {
    AppData.previous();
}

export function shuffle() {
    AppData.shuffle();
}

export function unshuffle() {
    AppData.unshuffle();
}

export async function addTagColumn() {
    const count = Utils.getNumColumns('listColumn');
    // Don't include child nodes in the clone.
    const col = document.getElementById('listColumn0').cloneNode(false);
    col.id = `listColumn${count}`;
    document.getElementById('tagColumnRow').appendChild(col);
    await AppData.saveConfig({ user: { tagColumnCount: Utils.getNumColumns('listColumn') }});
    await AppData.fire('tags', true);
}

export async function removeTagColumn() {
    if (Utils.getNumColumns('listColumn') <= 1) {
        return false;
    }
    const list = document.getElementById('tagColumnRow');
    const col = document.getElementById(`listColumn${Utils.getNumColumns('listColumn') - 1}`);
    list.removeChild(col);
    await AppData.saveConfig({ user: { tagColumnCount: Utils.getNumColumns('listColumn') }});
    await AppData.fire('tags', true);
}

export async function autoplayCheckboxClick() {
    const checked = $("#autoplayCheckbox").is(':checked');
    await Utils.err(async function() {
        await AppData.saveConfig({ user: { autoplayEnabled: checked }});
    }, "Unable to save autoplay settings");
}

export async function stateCheckboxClick() {
    const checked = $("#stateCheckbox").is(':checked');
    await Utils.err(async function() {
        await AppData.saveConfig({ user: { stateEnabled: checked }});
        await AppData.updateState();
    }, "Unable to save autoplay settings");
}

export function toggleTags(state) {
    if (state !== undefined) {
        if (state == Utils.isTagsVisible()) {
            return;
        }
    }

    if (Utils.isTagsVisible()) {
        $('#tagColumnsContainer').css("cssText", "display: none !important");
        Utils.hideModal("#tagModal");
    } else {
        if (window.innerWidth > Utils.MIN_WIDTH_TAG_PANEL && !Utils.isMobile()) {
            $('#tagColumnsContainer').css("cssText", "");
            // Fire tags redraw event to re-calculate the width when it's opened.
            AppData.fire('tags', true);
        } else {
            Utils.showModal("#tagModal");
        }
    }
}
