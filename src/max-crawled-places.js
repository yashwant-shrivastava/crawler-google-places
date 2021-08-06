const Apify = require('apify');

const MAX_CRAWLED_PLACES_STATE_RECORD_NAME = 'MAX_CRAWLED_PLACES_STATE';

module.exports = class MaxCrawledPlacesTracker {
    /**
     * @param {number} maxCrawledPlaces 
     * @param {number} maxCrawledPlacesPerSearch 
     */
    constructor(maxCrawledPlaces, maxCrawledPlacesPerSearch) {
        this.maxCrawledPlaces = maxCrawledPlaces;
        this.maxCrawledPlacesPerSearch = maxCrawledPlacesPerSearch;
        this.enqueuedTotal = 0;
        /** @type {Object.<string, number>} */
        this.enqueuedPerSearch = {};
    }

    /**
     * @param {any} events
     */
    async initialize(events) {
        const loadedState = /** @type {{ enqueuedTotal: number, enqueuedPerSearch: Object.<string, number>} | undefined} */ (await Apify.getValue(MAX_CRAWLED_PLACES_STATE_RECORD_NAME));
        if (loadedState) {
            this.enqueuedTotal = loadedState.enqueuedTotal;
            this.enqueuedPerSearch = loadedState.enqueuedPerSearch;
        }

        events.on('persistState', async () => {
            await this.persist();
        });
    }

    /**
     * Returns true if we can still enqueue more for this search string
     * @param {string} [searchString]
     * @returns {boolean}
     */
    canEnqueueMore(searchString) {
        if (this.enqueuedTotal >= this.maxCrawledPlaces) {
            return false;
        }
        if (searchString && this.enqueuedPerSearch[searchString] >= this.maxCrawledPlacesPerSearch) {
            return false;
        }
        return true;
    }

    /**
     * You should use this stateful function before each enqueueing
     * Increments a counter for enqueued requests
     * Returns true if the requests count was incremented
     * and the request should be really enqueued, false if not
     * @param {string} [searchString]
     * @returns {boolean}
     */
    setEnqueued(searchString) {
        if (searchString && !this.enqueuedPerSearch[searchString]) {
            this.enqueuedPerSearch[searchString] = 0;
        }
        
        const canEnqueueMore = this.canEnqueueMore(searchString);
        if (!canEnqueueMore) {
            return false;
        }
        this.enqueuedTotal++;
        if (searchString) {
            this.enqueuedPerSearch[searchString]++;
        }
        return true;
    }

    async persist() {
        await Apify.setValue(
            MAX_CRAWLED_PLACES_STATE_RECORD_NAME,
            { enqueuedTotal: this.enqueuedTotal, enqueuedPerSearch: this.enqueuedPerSearch }
        );
    }
}
