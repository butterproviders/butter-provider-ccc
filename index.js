'use strict';

var Provider = require('butter-provider')
var moment = require('moment')
var axios = require('axios')
var debug = require('debug')('butter-provider-ccc')

const defaultConfig = {
    name: 'ccc',
    uniqueId: 'imdb_id',
    tabName: 'CCC',
    defaults: {
        urlList: ['https://media.ccc.de/public'],
        formats: [
            'video/webm',
            'video/mp4'
        ],
        timeout: 40000,
        limit: 10
    },
    argTypes: {
        urlList: Provider.ArgType.ARRAY,
        langs: Provider.ArgType.ARRAY,
        formats: Provider.ArgType.ARRAY,
        timeout: Provider.ArgType.NUMBER,
        limit: Provider.ArgType.NUMBER
    }
}

function getEventDate(event) {
    if (event.date) {
        return event.date.split('T')[0];
    }

    return event.release_date;
}

function processEvents(events, langs) {
    let days = {}
    let result = events
        .filter((event) => {
            if (langs) {
                return langs.indexOf(event.original_language) !== -1
            }

            return true
        }).map((event) => {
            var day = getEventDate(event);
            days[day] = 1;

            return Object.assign({}, event, {
                first_aired: event.date ? moment(event.date).unix() : 0,
                day: day
            })
        });

    return {
        events: result,
        days: days
    }
}

function generateEventTorrents(formats, data) {
    var recordings = formats.reduce((a, f) => {
        if (a.length !== 0) {
            return a;
        }

        return data.recordings.filter((r) => (r.mime_type === f))
    }, [])

    return recordings.reduce((a, r) => {
        var quality = Object.keys(Provider.QualityType)
                            .map((q) => (Provider.QualityType[q]))
                            .reduce((ret, c) => {
                                if (Math.abs(r.height - parseInt(ret, 10)) <
                                    Math.abs(r.height - parseInt(c, 10))) {

                                    return ret
                                }

                                return c
                            }, 0)

        a[quality] = {
            size: r.size * 1000000,
            url: `${r.recording_url}.torrent`,
            peers: 0,
            seeds: 0
        }

        return a;
    }, {})
}

function formatEventForButter(torrents, event, idx) {
    return {
        torrents: torrents,
        watched: {
            watched: false
        },
        date_based: false,
        first_aired: event.first_aired,
        overview: event.description,
        synopsis: event.description,
        title: event.title,
        episode: idx,
        season: event.season,
        tvdb_id: event.slug
    }
}

module.exports = class CCC extends Provider {
    constructor (args, config = defaultConfig) {
        super(args, config)

        this.urlList = this.args.urlList
        this.limit = this.args.limit
        this.axiosConfig = {
            baseURL: this.urlList[0],
            strictSSL: false,
            json: true,
            timeout: this.args.timeout
        }
        this.axios = axios.create(this.axiosConfig)

        debug('created instance with', this.axiosConfig)
    }

    formatElementForButter(data) {
        var langs = this.args.langs;

        var id = data.url.split('/').pop();
        var updated = moment(data.updated_at);
        var year = updated.year();
        var img = data.logo_url;

        return this.axios.request({baseURL: data.url})
            .then((res) => {
                let conf = res.data

                debug('ok, got conf', conf)
                var {events, days} = processEvents(conf.events, langs)
                if (events.length === 0) {
                    return null
                }

                days = Object.keys(days);

                return {
                    type: Provider.ItemType.TVSHOW,
                    _id: id,
                    imdb_id: `ccc${id}`,
                    tvdb_id: `ccc-${data.acronym}`,
                    title: data.title,
                    genres: [
                        'Event',
                        'Conference'
                    ],
                    year: year,
                    poster: img,
                    backdrop: img,
                    slug: data.slug,
                    rating: {
                        hated: 0,
                        loved: 0,
                        votes: 0,
                        percentage: 0,
                        watching: 0
                    },
                    num_seasons: days.length,
                    days: days,
                    raw_events: events,
                    last_updated: updated.unix()
                }
            })
    }

    formatForButter(data) {
        if (!data) {
            return Promise.reject(new Error('No Data !'));
        }

        return Promise.all(data
            .slice(this.limit)
            .map(this.formatElementForButter.bind(this))
            .filter((d) => (d)))
                      .then((results) => ({
                          results: results,
                          hasMore: true
                      }))
    }

    queryTorrents(filters = {}) {
        let query = '/conferences'
        var params = {}
        //var genres = ''
        params.sort = 'seeds'
        params.limit = '50'

        if (filters.keywords) {
            params.keywords = filters.keywords.replace(/\s/g, '% ');
        }

        if (filters.genre) {
            /*
               filters.genres.forEach(function(g) {
               genres += '&genre[]='+g;
               });
               genres = genres.substring(0, genres.length - 1);
               win.info('genres', genres);
             */
            params.genre = filters.genres[0];
        }

        if (filters.order) {
            params.order = filters.order;
        }

        if (filters.sorter && filters.sorter !== 'popularity') {
            params.sort = filters.sorter;
        }

        debug('query', query)

        return this.axios.get(query)
            .then((res) => (res.data.conferences))
            .catch((err) => {
                debug('CCC', 'error', err)
            })
    }

    formatDetailsForButter(data) {
        var events = data.raw_events
        Reflect.deleteProperty(data.raw_events)
        var URL = this.URL
        var formats = this.args.formats

        var eventPromises = data.days.sort().reduce((a, d) => {
            var dayEvents = events
                .filter((e) => (e.day === d))
                .sort((a, b) => (a.first_aired > b.first_aired))
                .map((event, idx) => {
                    var day = getEventDate(event);
                    event.season = data.days.indexOf(day) + 1;

                    return this.axios.get(`/events/${event.guid}`)
                        .then((res) => (formatEventForButter(
                            generateEventTorrents(formats, res.data),
                            event, idx
                        )))
                })

            return a.concat(dayEvents)
        }, [])

        var updated = moment(data.updated)

        return Promise.all(eventPromises)
                      .then((events) => ({
                          synopsis: data.title,
                          country: '',
                          network: 'CCC Media',
                          status: 'finished',
                          runtime: 30,
                          last_updated: updated.unix(),
                          __v: 0,
                          episodes: events
                      }))
    }

    // Single element query
    detail(torrent_id, old_data) {
        return this.formatDetailsForButter(old_data)
                   .then((new_data) => (Object.assign(old_data, new_data)))
    }

    fetch(filters = {}) {
        return this.queryTorrents(filters)
                   .then(this.formatForButter.bind(this))
    }
}

