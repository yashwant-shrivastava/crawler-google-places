const Apify = require('apify');

const typedefs = require('./typedefs'); // eslint-disable-line no-unused-vars

const { utils: { log } } = Apify;

class Stats {
    constructor() {
        /** @type {typedefs.InnerStats} */
        this.stats = { failed: 0, ok: 0, outOfPolygon: 0, outOfPolygonCached: 0, places: 0, maps: 0 };
    }

    /**
     * @param {any} events
     */
    async initialize(events) {
        const loadedStats = /** @type {typedefs.InnerStats | undefined} */ (await Apify.getValue('STATS'));
        if (loadedStats) {
            this.stats = loadedStats;
        }
        events.on('persistState', async () => {
            await this.saveStats();
        });
    }

    async logInfo() {
        const statsArray = [];

        for (const [key, value] of Object.entries(this.stats)) {
            statsArray.push(`${key}: ${value}`);
        }

        log.info(`[STATS]: ${statsArray.join(' | ')}`);
    }

    async saveStats() {
        await Apify.setValue('STATS', this.stats);
        await this.logInfo();
    }

    failed() {
        this.stats.failed++;
    }

    ok() {
        this.stats.ok++;
    }

    outOfPolygon() {
        this.stats.outOfPolygon++;
    }

    maps() {
        this.stats.maps++;
    }

    places() {
        this.stats.places++;
    }

    outOfPolygonCached() {
        this.stats.outOfPolygonCached++;
    }
}

module.exports = Stats;
