
$(function () {

    // This object is exposed globally, so that other code may register a
    // callback with it (using 'register_callback').
    //
    // The object encapsulates a rolling history; the 'history' attribute is an
    // object which includes a list of recent songs.  The attribute is updated
    // by a regular ajax call to the server.  Every time the ajax call
    // completes, registered callbacks are invoked with a change flag (has the
    // history data actually changed?) and the history structure itself.
    RSAB_NP = {}

    // Need this in .htaccess to make this call work from other servers:
    //     Header set Access-Control-Allow-Origin *
    RSAB_NP.HISTORY_URL = 'http://listen.rsab.org/nowplaying/recent.json'
    RSAB_NP.INTERVAL = 30

    RSAB_NP.last_update = 0
    RSAB_NP.history = []
    RSAB_NP.callbacks = []

    RSAB_NP.ajax_timeout_id = null

    // Utility function to queue up another ajax call.  Called once to get the
    // ball rolling, then called by the update function itself.  (We use this
    // system instead of setInterval to allow for the update taking longer than
    // the interval time.)
    RSAB_NP._queue_update = function (seconds) {
        RSAB_NP.ajax_timeout_id = setTimeout('RSAB_NP._update_history_from_server()', seconds*1000)
    }

    // Public function: use this to register a callback that's interested in
    // the changing history.  The callback must receive two parameters: a bool
    // indicating if the data has changed, and a history structure.  This
    // function returns an ID which may be used to deregister the callback
    // later.
    RSAB_NP.register_callback = function(callback) {
        var index = RSAB_NP.callbacks.length
        RSAB_NP.callbacks.push(callback)
        if(RSAB_NP.ajax_timeout_id == null) {
            RSAB_NP._queue_update(0)
        }
        return index
    }

    // Public function: call this with the ID of a previously-registered
    // callback function to deregister that function.  It will no longer be
    // invoked when the history changes.  Returns true if something was removed
    // or false otherwise (on a bad ID, or if the callback had already gone).
    RSAB_NP.deregister_callback = function(index) {
        if(index < RSAB_NP.callbacks.length) {
            var result = (RSAB_NP.callbacks[index] !== null)
            RSAB_NP.callbacks[index] = null
            return result
        }
        return false
    }

    RSAB_NP._invoke_callbacks = function (changed_flag) {
        for(var i = 0; i < RSAB_NP.callbacks.length; i++) {
            // Skip deregistered callbacks.
            if(RSAB_NP.callbacks[i] !== null) {
                RSAB_NP.callbacks[i](changed_flag, RSAB_NP.history)
            }
        }
    }

    RSAB_NP._ajax_success = function (data) {
        var changed = false

        if(typeof(data.last_history_change) == 'undefined') {
            changed = true
        }
        else if(data.last_history_change > RSAB_NP.last_update) {
            RSAB_NP.last_update = data.last_history_change
            changed = true
        }
        if(changed) {
            if(typeof(data.history) == 'undefined' || data.history == null) {
                data.history = []
            }
            if(typeof(data.current_duration) == 'undefined') {
                data.current_duration = 0
            }
            if(typeof(data.is_playing) == 'undefined') {
                data.is_playing = false
            }
            RSAB_NP.history = data
        }

        RSAB_NP._invoke_callbacks(changed)
        RSAB_NP._queue_update(RSAB_NP.INTERVAL)
    }

    RSAB_NP._ajax_error = function () {
        RSAB_NP._invoke_callbacks(false)
        RSAB_NP._queue_update(RSAB_NP.INTERVAL)
    }

    // IE doesn't like cross-domain requests even with CORS, so we have to use
    // the XDomainRequest object instead.
    if('XDomainRequest' in window && window.XDomainRequest !== null) {
        RSAB_NP._update_history_from_server = function () {
            var xdr = new XDomainRequest();
            xdr.open("get", RSAB_NP.HISTORY_URL + '?dummy=' + (new Date()).getTime());
            xdr.onload = function () {
                //parse response as JSON
                var JSON = $.parseJSON(xdr.responseText);
                if (JSON == null || typeof (JSON) == 'undefined')
                {
                    JSON = $.parseJSON(data.firstChild.textContent);
                }
                RSAB_NP._ajax_success(JSON);
            };
            xdr.onerror = function () {
                RSAB_NP._ajax_error();
            }
            xdr.send();
        }

    // IE6 doesn't seem to like the XDR either, so that browser is unsupported.
    } else if($.browser.msie && parseInt($.browser.version.split(".")[0]) < 7) {
        RSAB_NP._update_history_from_server = function () {
            // Do nothing
        }

    // For everything else we'll use the jQuery ajax code.
    } else {
        RSAB_NP._update_history_from_server = function () {
            $.ajax({
                url: RSAB_NP.HISTORY_URL,
                dataType: 'json',
                cache: false,
                type: 'GET',
                success: function(data, textStatus, jqXHR) {
                    RSAB_NP._ajax_success(data)
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    RSAB_NP._ajax_error()
                }
            })
        }
    }

    $.widget('ui.rsabnowplaying', {
        _create: function() {
            this.np_current = null
            this.np_previous = null
            this.np_is_playing = false
            var self = this
            RSAB_NP.register_callback($.proxy(self._nowplaying_callback, self))
        },

        _redraw_one_item: function(np_data, artist_node, title_node, joiner_node) {
            var artist = ''
            var title = ''
            if (np_data != null) {
                artist = np_data.artist
                title = np_data.title
            }

            if (artist_node.length && artist != artist_node.text()) {
                artist_node.text(artist)
            }
            if (title_node.length && title != title_node.text()) {
                title_node.text(title)
            }
            if (joiner_node.length) {
                if(artist_node.text() && title_node.text()) {
                    joiner_node.show()
                }
                else {
                    joiner_node.hide()
                }
            }
        },

        redraw: function() {
            var top = $(this.element)
            var show_current = null
            var show_previous = null

            if (this.np_is_playing) {
                show_current = this.np_current
                show_previous = this.np_previous
            }
            else {
                show_current = null
                show_previous = this.np_current
            }

            this._redraw_one_item(
                show_current,
                $('.rsab-np-artist', top),
                $('.rsab-np-title', top),
                $('.rsab-np-joiner', top)
            )

            this._redraw_one_item(
                show_previous,
                $('.rsab-np-last-artist', top),
                $('.rsab-np-last-title', top),
                $('.rsab-np-last-joiner', top)
            )
        },

        _nowplaying_callback: function(changed, history_data) {
            this.np_current = null
            this.np_previous = null
            if(history_data.history.length >= 1) {
                this.np_current = history_data.history[history_data.history.length - 1]
                if(history_data.history.length >= 2) {
                    this.np_previous = history_data.history[history_data.history.length - 2]
                }
            }
            this.np_is_playing = history_data.is_playing
            if(changed) {
                this.redraw()
            }
        }
    })

})

