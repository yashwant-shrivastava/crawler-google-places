const Apify = require('apify'); // eslint-disable-line no-unused-vars

/**
 * Options for the scraping process
 * @typedef ScrapingOptions
 * @property {boolean} includeHistogram
 * @property {boolean} includeOpeningHours
 * @property {boolean} includePeopleAlsoSearch
 * @property {number} maxReviews
 * @property {number} maxImages
 * @property {number} [maxCrawledPlaces]
 * @property {number} [maxAutomaticZoomOut]
 * @property {boolean} exportPlaceUrls
 * @property {boolean} additionalInfo
 * @property {boolean} cachePlaces
 * @property {string} reviewsSort
 * @property {string} language
 * @property {number} multiplier
 * @property {object} geo
 */

/**
 * Options to set up the crawler
 * @typedef CrawlerOptions
 * @property {Apify.RequestQueue} requestQueue
 * @property {Apify.ProxyConfiguration | null} [proxyConfiguration]
 * @property {Apify.PuppeteerPoolOptions} puppeteerPoolOptions
 * @property {number} [maxConcurrency]
 * @property {Apify.LaunchPuppeteerFunction} launchPuppeteerFunction
 * @property {boolean} useSessionPool
 * @property {number} pageLoadTimeoutSec
 * @property {number} handlePageTimeoutSecs
 * @property {number} maxRequestRetries
 */

/**
 * Options you can pass to the actor run
 * @typedef Input
 * @property {Apify.RequestOptions[]} [startUrls]
 * @property {string[]} [searchStringsArray]
 * @property {string} [lat]
 * @property {string} [lng]
 * @property {string} [country]
 * @property {string} [state]
 * @property {string} [city]
 * @property {string} [postalCode]
 * @property {number} [zoom]
 * @property {number} [pageLoadTimeoutSec]
 * @property {boolean} [useChrome]
 * @property {number} [maxConcurrency]
 * @property {number} [maxPagesPerBrowser]
 * @property {number} [maxPageRetries]
 * @property {Apify.ProxyConfigurationOptions} [proxyConfig]
 * @property {boolean} [regularTestRun]
 * @property {boolean} [debug]
 * @property {string} [language]
 * @property {boolean} [useStealth]
 * @property {boolean} [headless]
 * @property {any} [walker]
 * @property {boolean} [includeHistogram]
 * @property {boolean} [includeOpeningHours]
 * @property {boolean} [includePeopleAlsoSearch]
 * @property {number} [maxReviews]
 * @property {number} [maxImages]
 * @property {boolean} [exportPlaceUrls]
 * @property {boolean} [additionalInfo]
 * @property {number} [maxCrawledPlaces]
 * @property {number} [maxAutomaticZoomOut]
 * @property {boolean} [cachePlaces]
 * @property {string} [reviewsSort]
 */
module.exports = {};
