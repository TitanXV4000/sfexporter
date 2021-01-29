exports.SF_URL = process.env.DB_URL || 'https://microfocus.lightning.force.com/lightning/r/Report/00O4J000004g7JKUAY/view?queryScope=userFolders';
exports.USER_LOGIN = process.env.USER_LOGIN || '';
exports.PASS = process.env.PASS || '';
exports.DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || '/tmp/sfexports';
exports.NODE_ENV = process.env.NODE_ENV || 'dev';
exports.LOG_LEVEL = process.env.LOG_LEVEL || 'debug';