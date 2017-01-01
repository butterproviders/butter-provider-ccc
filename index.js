'use strict';

var Provider = require('butter-provider');
var querystring = require('querystring');
var Q = require('q');
var deferRequest = require('defer-request');
var inherits = require('util').inherits;
var _ = require('lodash');
var moment = require('moment');

var CCC = function (args) {
    CCC.super_.call(this, args);

    this.URL = this.args.urlList[0];
};

inherits(CCC, Provider);

CCC.prototype.config = {
    name: 'ccc',
    uniqueId: 'imdb_id',
    tabName: 'CCC',
    defaults: {
        urlList: ['https://media.ccc.de/public'],
        formats: ['video/webm', 'video/mp4']
    },
    args: {
        urlList: Provider.ArgType.ARRAY,
        langs: Provider.ArgType.ARRAY,
        formats: Provider.ArgType.ARRAY
    }
};

CCC.prototype._queryTorrents = function (filters) {
    var params = {};
    var genres = '';
    params.sort = 'seeds';
    params.limit = '50';

    if (filters.keywords) {
        params.keywords = filters.keywords.replace(/\s/g, '% ');
    }

    if (filters.genre) {
        //            filters.genres.forEach(function(g) {
        //                genres += '&genre[]='+g;
        //            });
        //            genres = genres.substring(0, genres.length - 1);
        //            win.info('genres', genres);
        params.genre = filters.genres[0];
    }

    if (filters.order) {
        params.order = filters.order;
    }

    if (filters.sorter && filters.sorter !== 'popularity') {
        params.sort = filters.sorter;
    }

    return deferRequest(this.URL + '/conferences')
        .then(function (data) {
            return data.conferences
        })
        .catch(function (err) {
            console.error ('CCC', 'error', err)
        })
};

var formatElementForButter = function (data) {
    var id = data.url.split('/').pop();
    var updated = moment(data.updated_at);
    var year = updated.year();
    var img = data.logo_url;
    return deferRequest(data.url)
        .then(function (conf) {
            var days = {}

            var events = conf.events.map(function (event) {
                var day = getEventDate(event);
                days[day] = 1;
                return Object.assign({}, event, {
                    first_aired: moment(event.date).unix(),
                    day: day
                } )
            }).sort(function(a, b) {
                return a.first_aired > b.first_aired;
            });

            days = Object.keys(days);
            return {
                type: Provider.ItemType.TVSHOW,
                _id: id,
                imdb_id: 'ccc' +id,
                tvdb_id: 'ccc-' + data.acronym,
                title: data.title,
                genres: ["Event", "Conference"],
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
};

var formatForButter = function(data) {
    if (!data) return Q.reject("No Data !");

    return Q.all(data.map(formatElementForButter))
        .then(function (results) {
            return {
                results: results,
                hasMore: true
            }
        })
}

var generateEventTorrents = function(formats, data) {
    var recordings = formats.reduce(function (a, f) {
        if (a.length !== 0) {
            return a;
        }

        return data.recordings.filter(function (r) {
            return r.mime_type === f;
        })
    }, [])

    return recordings.reduce(function (a, r) {
        var quality = Object.keys(Provider.QualityType).map(function(q){
            return Provider.QualityType[q];
        }).reduce(function(ret, c) {
            return (Math.abs(r.height - parseInt(ret)) < Math.abs(r.height - parseInt(c))) ? ret : c;
        }, 0)

        a[quality] = {
            size: r.size * 1000000,
            url: r.recording_url + '.torrent',
            peers: 0,
            seeds: 0
        }
        return a;
    }, {})
}

var formatEventForButter = function(formats, event, idx, data) {
    return {
        torrents: generateEventTorrents(formats, data),
        watched: {
            watched: false,
        },
        date_based: false,
        overview: event.description,
        synopsis: event.description,
        title: event.title,
        episode: idx,
        season: event.season,
        tvdb_id: event.slug,
    }

}

function getEventDate(event) {
    if (event.date)
        return event.date.split('T')[0];
    return event.release_date;
}

CCC.prototype._formatDetailsForButter = function(data) {
    var events = data.raw_events;
    var URL = this.URL;
    var langs = this.args.langs;
    var formats = this.args.formats;

    var eventPromises = data.days.sort().reduce(function(a, d) {
        var dayEvents = events.filter(function(e) {
            return e.day === d
        }).filter(function(event) {
            return langs?(langs.indexOf(event.original_language) != -1):true;
        }).map(function(event, idx) {
            var day = getEventDate(event);
            event.season = data.days.indexOf(day) + 1;
            console.log('day', day, event.season);
            return deferRequest(URL + '/events/' + event.guid)
                .then(function (data) {
                    return formatEventForButter(formats, event, idx, data)
                })
        })

        return a.concat(dayEvents)
    }, [])

    var updated = moment(data.updated)
    return Q.all(eventPromises)
        .then(function(events) {
            return {
                synopsis: data.title,
                country: "",
                network: "CCC Media",
                status: "finished",
                runtime: 30,
                last_updated: updated.unix(),
                __v: 0,
                episodes: events
            }
        })
}

// Single element query
CCC.prototype.detail = function (torrent_id, old_data, debug) {
    return this._formatDetailsForButter.apply(this, [old_data])
        .then(function (new_data) {
            return Object.assign(old_data, new_data)
        })
};

CCC.prototype.fetch = function (filters) {
    return this._queryTorrents.apply(this, [filters])
        .then(formatForButter);
};

module.exports = CCC;
