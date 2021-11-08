/* 
sfexporter
grabs an export of the specified report in csv format once per minute
jwalker
*/
var config = require('./config');
const puppeteer = require('puppeteer');
const jwalkerLogger = require('tsanford-logger');
const chokidar = require('chokidar');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

const logger = jwalkerLogger.newLogger();
logger.info("Starting up.");

const tempDownloadPath = `${config.DOWNLOAD_PATH}/${config.REPORT_TAG}`;

//var downloading = false;
var downloadFinished = false;
var fileMoved = false;


(async () => {
  /* Create temp download directory */
  try {
    await makeTempDir();
  } catch (e) {
    logger.error(e);
    logger.error('Error unrecoverable. Exiting...');
    process.exit(5);
  }

  /* Create filesystem listener to watch download progress */
  const watcher = chokidar.watch(tempDownloadPath, {ignored: /\.csv$/g, persistent: true});
  watcher
    .on('add', function(filePath)  {
      logger.debug('Download of file ' + filePath + ' has begun.');
    })
    //.on('change', function(filePath)  { logger.debug('File ' + filePath + ' has been changed.'); })
    .on('unlink', async function(filePath)  {
      let basename = path.basename(filePath, '.crdownload');
      logger.debug('File has finished downloading: ' + basename);
      downloadFinished = true;
      
      try {
        await moveFile(`${tempDownloadPath}/${basename}`,
                       `${config.DOWNLOAD_PATH}/${config.REPORT_TAG}_${basename}`);
      } catch (e) {
        logger.error(e);
        process.exit(5);
      }
    })
    .on('error', function(error) { logger.error('Error happened: ' + error); });

  try {

  /* Initiate the Puppeteer browser */
  const browser = await puppeteer.launch({
    // headless: false,
    // slowMo: 250,
    // defaultViewport: null,
    args: ['--no-sandbox'], // necessary to work with puppeteer docker image
  });
  logger.debug("Browser loaded.");

  const context = browser.defaultBrowserContext();
  context.overridePermissions(config.SF_URL, ["notifications"]);

  const page = await browser.newPage();
  logger.debug("Blank page loaded.");

  /* Go to the page and wait for it to load */
  await page.goto(config.SF_URL, { waitUntil: 'networkidle2' });
  logger.debug("Salesforce initial auth page loaded.");

  /* Click on the SSO button */
  await Promise.all([
    await sleep(10000),
    await page.click('#idp_section_buttons > button > span'),
    await page.keyboard.press('Enter'),
    waitForNetworkIdle(page, 20000, 0),
    logger.debug("Navigating to SSO page."),
  ]);

  /* Enter username/password */
  await Promise.all([
    await page.type('#username', config.USER_LOGIN),
    await page.type('#password', config.PASS),
    await page.keyboard.press('Enter'),
    logger.info("Logged in to Salesforce. Please wait..."),
    await sleep(28000),
    waitForNetworkIdle(page, 2000, 0),
    logger.debug("Salesforce report page loaded."),
  ]);

  /* Set download location */
  await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: tempDownloadPath});

  /* Traverse the page with key presses to download the report */
  var finished = false;
  //try {
    // Click the "Export Details" button. Only needs to happen once.
    await page.evaluate(() => {
      document.querySelector("#report > div.bFilterReport > div.reportActions > input:nth-child(8)")
        .click();
    });
    logger.silly("Clicked \"Export Details\" button.");
    await sleep(5000);

    do {
      // Change report type to csv
      await pressKey(page, 'Tab', 4);
      await pressKey(page, 'ArrowUp');
      logger.silly("Pressed [TAB TAB ARROWUP] keys.");
      
      // Click the "Export" button to begin download. 
      // It seems to take around 20 seconds for the download to complete once the export button is clicked.
      await page.evaluate(() => {
        document.querySelector("#bottomButtonRow > input:nth-child(1)")
          .click();
      });
      logger.silly("Clicked \"Export\" button.");

      /* Verify file was downloaded */
      logger.debug("Waiting for download to start...");
      await waitForDownload(config.DOWNLOAD_TIMEOUT);

      logger.debug("Reloading page.");
      await page.reload();

      logger.debug("Reloaded. Sleeping... " + config.REPORT_INTERVAL + "ms");
      await sleep (config.REPORT_INTERVAL);
    } while (!finished);
  } catch (err) {
    finished = true;
    logger.error("Error caught during export procedure: " + err);
  } finally {
    try {
      if (browser !== null ) {
        await browser.close();
      }
      logger.info("Browser closed. Exiting.");
    } catch (err) {
      logger.error("Error caught during browser.close(): " + err);
    } finally {
      process.exit();
    }
  }
})();


/* Works with the chokidar watcher to wait for the file download to complete */
async function waitForDownload(timeout = 60000 /* ms */) {
  var complete = false;
  var elapsedTime = 0;
  do {
    if (downloadFinished && fileMoved) {
      logger.debug("File download completed and moved to non-temp directory.");
      downloadFinished = false;
      fileMoved = false;
      complete = true;
    } else {
      if (elapsedTime >= timeout) throw new Error("Download timeout reached.");
      logger.silly("Still waiting for download to complete. Time elapsed: " + elapsedTime / 1000 + " seconds.");
      elapsedTime += 1000;
      await sleep(1000);
    }
  } while (!complete);
}


/* Presses the key x times */
async function pressKey(page, key, presses = 1) {
  if (presses == 1) {
    await page.keyboard.press(key);
  } else {
    for (var i = 0; i < presses; i++) {
      await page.keyboard.press(key);
      await sleep(200);
    }
  }
}


async function makeTempDir() {
  try {
    await fsPromises.mkdir(tempDownloadPath);
  } catch (e) {
    if (e.errno != -17) throw e; // -17 file already exists
  }
}


async function moveFile(oldname, newname) {
  logger.debug(`Moving file ${oldname} to ${newname}`);
  try {
    await fsPromises.rename(oldname, newname);
    logger.debug('File move complete.');
    fileMoved = true;
  } catch (e) { 
    logger.error('Throwing error from moveFile()');
    throw e;
  }
}


/* Use if 500ms timeout of 'networkidleX' is insufficient */
function waitForNetworkIdle(page, timeout, maxInflightRequests = 0) {
  page.on('request', onRequestStarted);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFinished);

  let inflight = 0;
  let fulfill;
  let promise = new Promise(x => fulfill = x);
  let timeoutId = setTimeout(onTimeoutDone, timeout);
  return promise;

  function onTimeoutDone() {
    page.removeListener('request', onRequestStarted);
    page.removeListener('requestfinished', onRequestFinished);
    page.removeListener('requestfailed', onRequestFinished);
    fulfill();
  }

  function onRequestStarted() {
    ++inflight;
    if (inflight > maxInflightRequests)
      clearTimeout(timeoutId);
  }
  
  function onRequestFinished() {
    if (inflight === 0)
      return;
    --inflight;
    if (inflight === maxInflightRequests)
      timeoutId = setTimeout(onTimeoutDone, timeout);
  }
}


/* They promised me this would not be needed... */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
} 
