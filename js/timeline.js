"use strict";
(function () {
    Array.prototype.getNextItem = function (a, b) {
        var c = this.indexOf(a); return b && c < this.length - 1 ? c++ : !b && c > 0 && c--, this[c]
    },
        Array.prototype.cycleItems = function (a, b) {
            var c = this.indexOf(a) + (b ? 1 : -1); return c === this.length ? c = 0 : 0 > c && (c = this.length - 1), this[c]
        },
        Date.prototype.add = function (a, b) {
            var c = new Date(this.getTime()); return c.setTime(this.getTime() + ("days" === b ? 24 : 1) * a * 60 * 60 * 1e3), c
        },
        Date.prototype.toUTCPath = function () {
            return this.toISOString().replace(/^(\d+)-(\d+)-(\d+)T(\d+):.*$/, "$1/$2/$3/$4")
        },
        String.prototype.trunc = function (a) {
            return this.length > a ? this.substr(0, a - 1) + "&hellip;" : this
        },
        Date.prototype.midnight = function () {
            return this.setHours(0), this.setMinutes(0), this.setSeconds(0), this.setMilliseconds(0), this
        },
        Date.prototype.toHourTime = function () {
            return this.setMinutes(0), this.setSeconds(0), this.setMilliseconds(0), this
        },
        Number.prototype.pad = function (a) {
            for (var b = String(this) ; b.length < (a || 2) ;) b = "0" + b; return b
        },
        Number.prototype.format = function (a) {
            return this.toFixed(a || 0).replace(/(\d)(?=(\d{3})+\.?)/g, "$1 ")
        },
        String.prototype.firstCapital = function () {
            return this.charAt(0).toUpperCase() + this.slice(1).toLowerCase()
        },
        Number.prototype.bound = function (a, b) {
            return Math.max(Math.min(this, b), a)
        },
        Math.deg2rad = function (a) { return a / 180 * Math.PI },
        String.prototype.template = function (a) {
            return this.replace(/\{(.+?)\}/g, function (b, c) { return a[c] || "" })
        },
        String.prototype.template2 = function (a) { return this.replace(/\{\{(.+?)\}\}/g, function (b, c) { return a[c] || "" }) }
}());
var timelineBarCtrl = function () {
    var timeline_bar_obj = document.getElementById("timeline-bar"),
        timeline_obj = document.getElementById("timeline");
    var barHours, wtimeline_bar, timeline_bar_left, minIndex, maxIndex, timeline_width, minLeft,
        earlierLength = 10, barIndex = 0;
    var currentTimeOffset = (new Date()).getHours();

    var timelineBar = Backbone.Model.extend({
        timelineLine: document.getElementById("timeline-line"),
        div: document.getElementById("timecode"),
        text: document.getElementById("timecode-box"),
        left: null,
        calendar: null,
        calendarDays: 0,
        ghostTimeLeft: 0,
        frontWidth: 105,
        update: function (position) {
            this.left = position;
            this.left = this.left < minLeft ? minLeft : this.left;
            this.timelineLine.style.width = this.div.style.left = this.left + "px";
            if (µ.isMobile()) {
                this.text.style.fontSize = "24px";
                this.text.style.height = "30px";
                this.text.style.marginTop = "-8px";
            }
            this.text.textContent = this.createText(this.left);
            return this.left;
        },
        createText: function (left, ghost) {
            var textContent = "", position = this.left - earlierLength;
            (position < 0) && (position = 0);
            if (this.calendar) {
                var c = this.calendar[Math.floor(this.calendarDays * position / wtimeline_bar)];
                if (!c) return;
                textContent = c.display ? (c.month && "" + c.month) + (c.day && "." + c.day + " ") + c.displayLong + " - " : c.day + "." + c.month + ": ";
            }
            return textContent += (parseInt(position / wtimeline_bar * barHours) % 24) + ":00";
        },
        addAnimation: function () {
            this.div.style.transition = this.timelineLine.style.transition = "all ease-in-out 250ms"
        },
        removeAnimation: function () {
            window.setTimeout(function () {
                this.div.style.transition = this.timelineLine.style.transition = null;
            }.bind(this), 300)
        },
        click: function (mouse) {
            this.addAnimation();
            var position = Math.max(0, Math.min(timeline_width, mouse.clientX - timeline_bar_left));
            this.update(position);
            barIndex = (this.left - earlierLength) / wtimeline_bar;
            this.set({ barIndex: barIndex });
            this.removeAnimation();
        },
        setIndex: function (index, disableAnime) {
            disableAnime || this.addAnimation(),
                barIndex = index > maxIndex ? maxIndex : index < minIndex ? minIndex : index;
            this.set({ barIndex: barIndex });
            this.update(barIndex * wtimeline_bar + earlierLength);
            disableAnime || this.removeAnimation();
        },
        getIndex: function () {
            return Number(this.get("barIndex"));
        },
        resize: function () {
            this.recalculate(),
                timeline_width = maxIndex * wtimeline_bar + earlierLength,
                minLeft = minIndex * wtimeline_bar + earlierLength
            timeline_obj.style.width = timeline_width + "px",
                this.setIndex(barIndex);
        },
        recalculate: function () {
            var a = timeline_bar_obj.getClientRects()[0];
            a && (timeline_bar_left = a.left, wtimeline_bar = a.width);
        },
        init: function (calendar) {
            var _this = this;
            this.calendar = calendar.days;
            this.calendarDays = this.calendar.length;
            barHours = 24 * calendar.calendarDays;
            maxIndex = calendar && calendar.maxIndex || 1;
            minIndex = calendar && calendar.minIndex || 0;
            this.resize();
        },
        initialize: function () {
            timeline_obj.addEventListener("click", this.click.bind(this));
            window.addEventListener("resize", this.resize.bind(this));
        }
    });

    var ghostTimeBoxCtrl = timelineBar.extend({
        div: document.getElementById("ghost-timecode"),
        text: document.getElementById("ghost-box"),
        left: 0,
        calendar: null,
        update: function (mouse) {
            this.left = Math.max(0, Math.min(timeline_width, mouse.clientX - timeline_bar_left));
            var position = Math.max(0, Math.min(timeline_width, mouse.clientX - timeline_bar_left));
            var index = (position - earlierLength) / wtimeline_bar;
            this.div.style.left = this.left + "px",
                this.div.style["margin-top"] = timelineBarConfig.left - this.left < 50 && this.left - timelineBarConfig.left < this.frontWidth ? "-48px" : "-16px",
                this.text.textContent = this.createText()
        },
        initialize: function () {
            var _this = this;
            timeline_obj.addEventListener("mouseenter", function (b) {
                _this.div.style.opacity = 1;
            }),
                timeline_obj.addEventListener("mousemove", function (b) {
                    _this.update(b);
                }),
                timeline_obj.addEventListener("mouseleave", function (b) {
                    _this.div.style.opacity = 0;
                })
        }
    });
    var timelineBarConfig = new timelineBar();
    new ghostTimeBoxCtrl();
    return timelineBarConfig;
}();
var calendarCtrl = function () {
    var calendar = Backbone.Model.extend({
        calendarDays: 8,
        numOfDays: 8,
        minIndex: 0,
        days: [],
        dayHours: {},
        sequence: 0,
        weekdaysUsed: ["日", "一", "二", "三", "四", "五", "六"],
        initialize: function () {
            this.numberOfHours = 24 * this.numOfDays;
            this.actualNumberOfHours = this.numberOfHours;
        },
        init: function (setting) {
            var _this = this;
            var firstTime = setting.minifest.data[0];
            var timelinebar = document.getElementById("timeline-bar");
            var inlineStyle = "",newLine="";
            if (µ.isMobile()) {
                inlineStyle = "font-size:16px;height:60px;margin-top:-6px;";
                newLine = "<br/>";
                timelinebar.style.bottom = "40px";
            }
            this.startOfTimeline = new Date();
            this.startOfTimeline.setUTCMonth(Number(firstTime.substr(0, 2)) - 1,firstTime.substr(2, 2));
            // this.startOfTimeline.setUTCDate(firstTime.substr(2, 2));
            this.startOfTimeline.setUTCHours(firstTime.substr(4));
            this.startOfTimeline = this.startOfTimeline.toHourTime();

            var endTime = setting.minifest.data[setting.minifest.data.length - 1];
            var endTimeSub1 = setting.minifest.data[setting.minifest.data.length - 2];
            var subEndTime = new Date();
            subEndTime.setUTCMonth(Number(endTimeSub1.substr(0, 2)) - 1, Number(endTimeSub1.substr(2, 2)));
            //subEndTime.setUTCDate(endTimeSub1.substr(2, 2));
            subEndTime.setUTCHours(endTimeSub1.substr(4));
            subEndTime = subEndTime.toHourTime();


            this.endOftimeline = new Date();
            this.endOftimeline.setUTCMonth(Number(endTime.substr(0, 2)) - 1, Number(endTime.substr(2, 2)));
            //this.endOftimeline.setUTCDate(endTime.substr(2, 2));
            this.endOftimeline.setUTCHours(endTime.substr(4));
            this.endOftimeline = this.endOftimeline.toHourTime();

            if (this.endOftimeline.getTime() < this.startOfTimeline.getTime()) {
                this.endOftimeline.setYear(this.endOftimeline.getFullYear() + 1);
            }
            if (subEndTime.getTime() < this.startOfTimeline.getTime()) {
                subEndTime.setYear(subEndTime.getFullYear() + 1);
            }

            var diffHours = Math.ceil((this.endOftimeline - subEndTime) / (1000 * 60 * 60));
            this.endOftimeline = this.endOftimeline.add(diffHours - 1);

            this.midnight = new Date();
            this.midnight.setTime(this.startOfTimeline.getTime());
            this.midnight.midnight();
            var firstNoon = this.midnight.add(12);
            var totalHours = Math.ceil((this.endOftimeline - this.startOfTimeline) / (1000 * 60 * 60));
            this.numOfDays = Math.ceil((this.endOftimeline - firstNoon) / (1000 * 60 * 60 * 24));
            this.calendarDays = (totalHours / 24 >= this.numOfDays) ? this.numOfDays + 1 : this.numOfDays;
            this.endOfcalendar = this.midnight.add(this.calendarDays, "days");
            this.numberOfHours = 24 * this.calendarDays;
            this.actualNumberOfHours = this.numberOfHours;
            for (var theDay, theWeekday, day = 0; day < this.calendarDays; day++) {
                theDay = firstNoon.add(day, "days");
                theWeekday = theDay.getDay();
                this.days[day] = {
                    display: " (" + this.weekdaysUsed[theWeekday] + ")",
                    //display: "星期" + this.weekdaysUsed[theWeekday],
                    displayLong: "星期" + this.weekdaysUsed[theWeekday],
                    day: theDay.getDate(),
                    index: this.day2index(day),
                    clickable: day <= this.numOfDays,
                    month: theDay.getMonth() + 1,
                    year: theDay.getFullYear()
                };
            }

            this.minIndex = this.time2index(this.startOfTimeline);
            this.maxIndex = this.time2index(this.endOftimeline);

            var calendarHtml = "",
                calendarOpt = "";
            for (var theDay, daysLen = this.days.length, l = 100 / daysLen, day = 0; daysLen > day; day++) {
                theDay = this.days[day];
                calendarHtml += (theDay.clickable ? '<div data-name="barIndex" data-value="' + theDay.index + '" class="clickable"' : "<div") + ' style="width:' + l + '%;' + inlineStyle + '">' + theDay.month + "." + theDay.day + newLine + theDay.display + "</div>";
            }
            document.getElementById("calendar").innerHTML = calendarHtml;

            this.createDayHoursFromMinifest(setting.minifest);
            this.initialPath = this.time2path(this.startOfTimeline);

            var calendarSel = document.getElementById("calendar-select");
            for (var dayHour in this.dayHours) {
                var theHour = this.dayHours[dayHour];
                calendarOpt += '<option value="' + dayHour + '"' + (dayHour === this.initialPath ? ' selected="true" ' : "") + ">" + theHour.month + "." + theHour.day + " " + theHour.text + " - " + theHour.hour + "</option>";
            }
            calendarSel.innerHTML = calendarOpt;

            this.set({ datePath: this.initialPath });
            return this;
        },
        day2index: function (day) { return day / this.calendarDays + .52 / this.calendarDays },
        createDayHoursFromMinifest: function (minifest) {
            var b, c, d, dataArray = minifest.data;
            for (d = 0; d <= this.numberOfHours; d++)
                b = this.midnight.add(d).toUTCPath(),
                    c = b.replace(/^\d+\/(\d+)\/(\d+)\/(\d+)$/, "$1$2$3"),
                (dataArray.indexOf(c) >= 0) && (this.dayHours[b] = this.produceDayHourObject(d), this.actualNumberOfHours = d);
            return this.dayHours;
        },
        produceDayHourObject: function (hours) {
            var theDay = this.days[parseInt(hours / 24)], currentTime = this.midnight.add(hours);
            return {
                text: theDay && theDay.display,
                day: theDay && theDay.day,
                month: theDay && theDay.month,
                hour: currentTime.getHours() + ":00",
                index: hours / (24 * this.calendarDays),
                sequence: this.sequence++,
                timestamp: currentTime.getTime()
            }
        },
        index2path: function (index) {
            var hours = this.dayHours;
            return Object.keys(hours).reduce(function (pre, cur) {
                //return Math.abs(hours[cur].index - index) < Math.abs(hours[pre].index - index) ? cur : pre // 採最近的時間點
                return hours[cur].index - index > 0 ? pre : cur; // 採最後時間
            })
        },
        time2index: function (time) {
            return (time - this.midnight) / (this.endOfcalendar - this.midnight)
        },
        time2path: function (time) {
            return this.index2path(this.time2index(time))
        },
        path2index: function (path) {
            var theHour = this.dayHours[path];
            if (theHour) return theHour.index;
            var date = this.path2date(path);
            return this.time2index(date.getTime())
        },
        path2date: function (path) {
            var pathArray = path.split("/");
            return new Date(Date.UTC(pathArray[0], pathArray[1] - 1, pathArray[2], pathArray[3], 0, 0))
        }
    });

    var c = new calendar();
    return c;
}();
