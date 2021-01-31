/* 
sfexporter
grabs an export of the specified report in csv format once per minute
jwalker
*/
var config = require('./config');
const puppeteer = require('puppeteer');
const winston = require('winston');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;

const myFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: combine(
    label({ label: 'sfexporter' }),
    timestamp(),
    myFormat
  ),
  defaultMeta: { service: 'user-service' },
  transports: [
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
  exitOnError: false,
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

(async () => {
  /* Initiate the Puppeteer browser */
  const browser = await puppeteer.launch({
    //headless: false,
    //slowMo: 250,
    //defaultViewport: null,
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
    page.click('#idp_section_buttons > button > span'),
    waitForNetworkIdle(page, 2000, 0),
    logger.debug("Navigating to SSO page."),
  ]);

  /* Enter username/password */
  await Promise.all([
    await page.type('#username', config.USER_LOGIN),
    await page.type('#password', config.PASS),
    await page.keyboard.press('Enter'),
    logger.info("Logged in to Salesforce. Please wait..."),
    await sleep(45000),
    waitForNetworkIdle(page, 1000, 0),
    logger.debug("Salesforce report page loaded."),
  ]);

  /* Set download location */
  await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: config.DOWNLOAD_PATH});

  /* Traverse the page with key presses to download the report */
  var finished = false;
  try {
    do {
      await sleep(10000);
      await page.mouse.click(755, 170);
      await sleep(1000); // wait for menu to open
      await pressKey(page, 'ArrowDown', 5);
      await pressKey(page, 'Enter');
      await sleep(5000); // wait for ui element to load
      await pressKey(page, 'ArrowRight');
      await pressKey(page, 'Tab');
      await pressKey(page, 'ArrowDown');
      await pressKey(page, 'Tab', 3);
      await pressKey(page, 'Enter');

      /* TODO verify file was downloaded */
      logger.info("Report downloaded.");
      logger.debug("Reloading page.");

      await sleep(10000);
      await page.reload();
      logger.debug("Reloaded. Sleeping...");
      await sleep (46000);
    } while (!finished);
  } catch (err) {
    finished = true;
    logger.error("Error caught during export procedure: " + err);
  } finally {
    await browser.close();
    logger.info("Browser closed. Exiting.");
    process.exit();
  }
})();


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