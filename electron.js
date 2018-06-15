const {app, BrowserWindow} = require('electron');
const ServerApp = require('./index.js');

let mainWindow = null;

function createWindow () {
    mainWindow = new BrowserWindow({width: 800, height: 600});
    mainWindow.maximize();
    mainWindow.loadURL(`http://localhost:${ServerApp.config.port}`);

    //mainWindow.webContents.openDevTools();

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', async function() {
    await ServerApp.setup();
    createWindow();
});

// Quit when all windows are closed.
app.on('window-all-closed', async function () {
    if (process.platform !== 'darwin') {
        ServerApp.shutdown();
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
