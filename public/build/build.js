/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./src/app.ts");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./src/app.ts":
/*!********************!*\
  !*** ./src/app.ts ***!
  \********************/
/*! no exports provided */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _grid__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./grid */ "./src/grid.ts");

window.addEventListener("load", function () {
    var picker = document.getElementById("filepicker");
    if (!picker) {
        console.log("picker error");
        return;
    }
    var canvas = document.getElementById("canvas");
    if (!canvas) {
        return;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx)
        return;
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var grid = new _grid__WEBPACK_IMPORTED_MODULE_0__["Grid"](canvas.width, canvas.height, 52);
    grid.setPadding(30);
    grid.setColor(0xff333333);
    grid.setStrokeWidth(0.5);
    grid.drawWithoudRepeat(ctx);
    picker.addEventListener("change", function () {
        if (picker.files) {
            var fr_1 = new FileReader();
            fr_1.onload = function (e1) {
                var i = new Image();
                i.onload = function () {
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(i, 0, 0, canvas.width, canvas.height);
                    grid.drawWithoudRepeat(ctx);
                };
                i.src = fr_1.result;
            };
            fr_1.readAsDataURL(picker.files[0]);
        }
    });
}, false);


/***/ }),

/***/ "./src/color.ts":
/*!**********************!*\
  !*** ./src/color.ts ***!
  \**********************/
/*! exports provided: Color */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "Color", function() { return Color; });
var Color = (function () {
    function Color(value) {
        if (value === void 0) { value = 0; }
        this.value = value;
    }
    Color.prototype.getColor = function () {
        return this.value;
    };
    Color.toArgbString = function (value) {
        return "rgba(" + Color.red(value) + "," + Color.green(value) + "," + Color.blue(value) + "," + Color.alpha(value) / 255 + ")";
    };
    Color.alpha = function (value) {
        return ((value >> 24) & 0xff);
    };
    Color.red = function (value) {
        return ((value >> 16) & 0xff);
    };
    Color.green = function (value) {
        return ((value >> 8) & 0xff);
    };
    Color.blue = function (value) {
        return (value & 0xff);
    };
    Color.make = function (r, g, b, a) {
        if (a === void 0) { a = 255; }
        return new Color(((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff));
    };
    Color.makeGray = function (v) {
        return Color.make(v, v, v);
    };
    Color.random = function () {
        var r = Math.floor(Math.random() * 0xff);
        var g = Math.floor(Math.random() * 0xff);
        var b = Math.floor(Math.random() * 0xff);
        return Color.make(r, g, b);
    };
    Color.randomGray = function () {
        return Color.makeGray(Math.floor(Math.random() * 0xff));
    };
    return Color;
}());



/***/ }),

/***/ "./src/grid.ts":
/*!*********************!*\
  !*** ./src/grid.ts ***!
  \*********************/
/*! exports provided: Grid */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "Grid", function() { return Grid; });
/* harmony import */ var _color__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./color */ "./src/color.ts");

var Grid = (function () {
    function Grid(w, h, r, c) {
        if (r === void 0) { r = 50; }
        if (c === void 0) { c = 0x44333333; }
        this.strokeWidth = 1;
        this.padding = 0;
        this.width = w;
        this.height = h;
        this.radius = r;
        this.color = c;
    }
    Grid.prototype.draw = function (canvas) {
        canvas.save();
        canvas.strokeStyle = _color__WEBPACK_IMPORTED_MODULE_0__["Color"].toArgbString(this.color);
        canvas.lineWidth = this.strokeWidth;
        canvas.imageSmoothingEnabled = false;
        var h = (this.radius * Math.sqrt(3)) / 2;
        var r = this.radius;
        var hs = h * 2;
        var vs = r * 1.5;
        var sw = Math.floor((this.width - (this.padding * 2)) / hs);
        var sh = Math.floor((this.height - (this.padding * 2)) / vs);
        var px = (this.width - (hs * sw)) / 2;
        var py = (this.height - (vs * sh)) / 2;
        console.log("Grids:" + (sw * sh - ((sh - 1) / 2)));
        for (var j = 0; j < sh; j++) {
            var swx = sw;
            var off = 0;
            if (j % 2 == 1) {
                off += h;
                swx = sw - 1;
            }
            for (var i = 0; i < swx; i++) {
                var cx = px + hs / 2 + i * hs + off;
                var cy = py + vs / 2 + j * vs;
                canvas.beginPath();
                for (var a = 0; a < 6; a++) {
                    var angle = this.radians(a * 60 + 90);
                    var x = (cx + Math.cos(angle) * r);
                    var y = (cy + Math.sin(angle) * r);
                    if (a == 0) {
                        canvas.moveTo(x, y);
                    }
                    else {
                        canvas.lineTo(x, y);
                    }
                }
                canvas.closePath();
                canvas.stroke();
            }
        }
        canvas.restore();
    };
    Grid.prototype.drawWithoudRepeat = function (canvas) {
        canvas.save();
        canvas.strokeStyle = _color__WEBPACK_IMPORTED_MODULE_0__["Color"].toArgbString(this.color);
        canvas.lineWidth = this.strokeWidth;
        canvas.imageSmoothingEnabled = false;
        var h = (this.radius * Math.sqrt(3)) / 2;
        var r = this.radius;
        var hs = h * 2;
        var vs = r * 1.5;
        var sw = Math.floor((this.width - (this.padding * 2)) / hs);
        var sh = Math.floor((this.height - (this.padding * 2)) / vs);
        var px = (this.width - (hs * sw)) / 2;
        var py = (this.height - (vs * sh)) / 2;
        console.log("Grids:" + (sw * sh - ((sh - 1) / 2)));
        for (var j = 0; j < sh + 1; j++) {
            var d = 1;
            var swx = sw;
            if (j % 2 == 1) {
                swx = sw;
                d = -1;
            }
            var lx = 0;
            var ly = 0;
            for (var i = 0; i < swx * 2 + 1; i++) {
                var cx = px + i * hs / 2;
                var cy = py + vs / 2 + j * vs;
                var x = cx;
                var y = cy - r / 2 + (j % 2 == 1 ? (i % 2 == 1 ? 0 : d * r / 2) : (i % 2 == 0 ? 0 : d * -r / 2));
                if (i != 0) {
                    if (j == sh && (i == 1 || i == swx * 2) && j % 2 == 0) {
                    }
                    else {
                        canvas.beginPath();
                        canvas.moveTo(lx, ly);
                        canvas.lineTo(x, y);
                        canvas.stroke();
                    }
                }
                if (i % 2 == 0) {
                    if (j != sh) {
                        if (j % 2 == 0) {
                            canvas.beginPath();
                            canvas.moveTo(x, y);
                            canvas.lineTo(x, y + r);
                            canvas.stroke();
                        }
                        else if (i != swx * 2) {
                            canvas.beginPath();
                            canvas.moveTo(x + hs / 2, y + r / 2);
                            canvas.lineTo(x + hs / 2, y + r + r / 2);
                            canvas.stroke();
                        }
                    }
                }
                lx = x;
                ly = y;
            }
        }
        canvas.restore();
    };
    Grid.prototype.setPadding = function (padding) {
        this.padding = padding;
    };
    Grid.prototype.setColor = function (color) {
        this.color = color;
    };
    Grid.prototype.setStrokeWidth = function (width) {
        this.strokeWidth = width;
    };
    Grid.prototype.radians = function (degrees) {
        return degrees * Math.PI / 180;
    };
    return Grid;
}());



/***/ })

/******/ });
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vL3NyYy9DOi93b3Jrc3BhY2UvamF2YXNjcmlwdC9oZXgtcHV6emxlLWdlbmVyYXRvci9zcmMvYXBwLnRzIiwid2VicGFjazovLy9zcmMvQzovd29ya3NwYWNlL2phdmFzY3JpcHQvaGV4LXB1enpsZS1nZW5lcmF0b3Ivc3JjL2NvbG9yLnRzIiwid2VicGFjazovLy9zcmMvQzovd29ya3NwYWNlL2phdmFzY3JpcHQvaGV4LXB1enpsZS1nZW5lcmF0b3Ivc3JjL2dyaWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOzs7QUFHQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0Esa0RBQTBDLGdDQUFnQztBQUMxRTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLGdFQUF3RCxrQkFBa0I7QUFDMUU7QUFDQSx5REFBaUQsY0FBYztBQUMvRDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsaURBQXlDLGlDQUFpQztBQUMxRSx3SEFBZ0gsbUJBQW1CLEVBQUU7QUFDckk7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxtQ0FBMkIsMEJBQTBCLEVBQUU7QUFDdkQseUNBQWlDLGVBQWU7QUFDaEQ7QUFDQTtBQUNBOztBQUVBO0FBQ0EsOERBQXNELCtEQUErRDs7QUFFckg7QUFDQTs7O0FBR0E7QUFDQTs7Ozs7Ozs7Ozs7Ozs7O0FDbEY4QjtBQUU5QixNQUFNLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFO0lBRTVCLElBQUksTUFBTSxHQUFHLFFBQVEsQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFxQixDQUFDO0lBRXZF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VyxHQUFHLDRDQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNwRCxNQUFNLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUM7UUFDcEMsTUFBTSxDQUFDLHFCQUFxQixHQUFHLEtBQUssQ0FBQztRQUVyQyxJQUFJLENBQUMsR0FBVyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNqRCxJQUFJLENBQUMsR0FBVyxJQUFJLENBQUMsTUFBTSxDQUFDO1FBRTVCLElBQUksRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDO1FBQ2QsSUFBSSxFQUFFLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQztRQUVqQixJQUFJLEVBQUUsR0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUNwRSxJQUFJLEVBQUUsR0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUVyRSxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLEdBQUcsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdEMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBRXZDLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMs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QUFNLENBQUMsTUFBTSxFQUFFLENBQUM7eUJBQ25CO3FCQUNKO2lCQUNKO2dCQUNELEVBQUUsR0FBRyxDQUFDLENBQUM7Z0JBQ1AsRUFBRSxHQUFHLENBQUMsQ0FBQzthQUNWO1NBQ0o7UUFDRCxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDckIsQ0FBQztJQUVNLHlCQUFVLEdBQWpCLFVBQWtCLE9BQWU7UUFDN0IsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7SUFDM0IsQ0FBQztJQUVNLHVCQUFRLEdBQWYsVUFBZ0IsS0FBYTtRQUN6QixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUN2QixDQUFDO0lBRU0sNkJBQWMsR0FBckIsVUFBc0IsS0FBYTtRQUMvQixJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQztJQUM3QixDQUFDO0lBR08sc0JBQU8sR0FBZixVQUFnQixPQUFlO1FBQzNCLE9BQU8sT0FBTyxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsR0FBRyxDQUFDO0lBQ25DLENBQUM7SUFFTCxXQUFDO0FBQUQsQ0FBQyIsImZpbGUiOiJidWlsZC5qcyIsInNvdXJjZXNDb250ZW50IjpbIiBcdC8vIFRoZSBtb2R1bGUgY2FjaGVcbiBcdHZhciBpbnN0YWxsZWRNb2R1bGVzID0ge307XG5cbiBcdC8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG4gXHRmdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cbiBcdFx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG4gXHRcdGlmKGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdKSB7XG4gXHRcdFx0cmV0dXJuIGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdLmV4cG9ydHM7XG4gXHRcdH1cbiBcdFx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcbiBcdFx0dmFyIG1vZHVsZSA9IGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdID0ge1xuIFx0XHRcdGk6IG1vZHVsZUlkLFxuIFx0XHRcdGw6IGZhbHNlLFxuIFx0XHRcdGV4cG9ydHM6IHt9XG4gXHRcdH07XG5cbiBcdFx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG4gXHRcdG1vZHVsZXNbbW9kdWxlSWRdLmNhbGwobW9kdWxlLmV4cG9ydHMsIG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG4gXHRcdC8vIEZsYWcgdGhlIG1vZHVsZSBhcyBsb2FkZWRcbiBcdFx0bW9kdWxlLmwgPSB0cnVlO1xuXG4gXHRcdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG4gXHRcdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbiBcdH1cblxuXG4gXHQvLyBleHBvc2UgdGhlIG1vZHVsZXMgb2JqZWN0IChfX3dlYnBhY2tfbW9kdWxlc19fKVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5tID0gbW9kdWxlcztcblxuIFx0Ly8gZXhwb3NlIHRoZSBtb2R1bGUgY2FjaGVcbiBcdF9fd2VicGFja19yZXF1aXJlX18uYyA9IGluc3RhbGxlZE1vZHVsZXM7XG5cbiBcdC8vIGRlZmluZSBnZXR0ZXIgZnVuY3Rpb24gZm9yIGhhcm1vbnkgZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5kID0gZnVuY3Rpb24oZXhwb3J0cywgbmFtZSwgZ2V0dGVyKSB7XG4gXHRcdGlmKCFfX3dlYnBhY2tfcmVxdWlyZV9fLm8oZXhwb3J0cywgbmFtZSkpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgbmFtZSwgeyBlbnVtZXJhYmxlOiB0cnVlLCBnZXQ6IGdldHRlciB9KTtcbiBcdFx0fVxuIFx0fTtcblxuIFx0Ly8gZGVmaW5lIF9fZXNNb2R1bGUgb24gZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yID0gZnVuY3Rpb24oZXhwb3J0cykge1xuIFx0XHRpZih0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wudG9TdHJpbmdUYWcpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgU3ltYm9sLnRvU3RyaW5nVGFnLCB7IHZhbHVlOiAnTW9kdWxlJyB9KTtcbiBcdFx0fVxuIFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xuIFx0fTtcblxuIFx0Ly8gY3JlYXRlIGEgZmFrZSBuYW1lc3BhY2Ugb2JqZWN0XG4gXHQvLyBtb2RlICYgMTogdmFsdWUgaXMgYSBtb2R1bGUgaWQsIHJlcXVpcmUgaXRcbiBcdC8vIG1vZGUgJiAyOiBtZXJnZSBhbGwgcHJvcGVydGllcyBvZiB2YWx1ZSBpbnRvIHRoZSBuc1xuIFx0Ly8gbW9kZSAmIDQ6IHJldHVybiB2YWx1ZSB3aGVuIGFscmVhZHkgbnMgb2JqZWN0XG4gXHQvLyBtb2RlICYgOHwxOiBiZWhhdmUgbGlrZSByZXF1aXJlXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnQgPSBmdW5jdGlvbih2YWx1ZSwgbW9kZSkge1xuIFx0XHRpZihtb2RlICYgMSkgdmFsdWUgPSBfX3dlYnBhY2tfcmVxdWlyZV9fKHZhbHVlKTtcbiBcdFx0aWYobW9kZSAmIDgpIHJldHVybiB2YWx1ZTtcbiBcdFx0aWYoKG1vZGUgJiA0KSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICYmIHZhbHVlLl9fZXNNb2R1bGUpIHJldHVybiB2YWx1ZTtcbiBcdFx0dmFyIG5zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiBcdFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yKG5zKTtcbiBcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5zLCAnZGVmYXVsdCcsIHsgZW51bWVyYWJsZTogdHJ1ZSwgdmFsdWU6IHZhbHVlIH0pO1xuIFx0XHRpZihtb2RlICYgMiAmJiB0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIGZvcih2YXIga2V5IGluIHZhbHVlKSBfX3dlYnBhY2tfcmVxdWlyZV9fLmQobnMsIGtleSwgZnVuY3Rpb24oa2V5KSB7IHJldHVybiB2YWx1ZVtrZXldOyB9LmJpbmQobnVsbCwga2V5KSk7XG4gXHRcdHJldHVybiBucztcbiBcdH07XG5cbiBcdC8vIGdldERlZmF1bHRFeHBvcnQgZnVuY3Rpb24gZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBub24taGFybW9ueSBtb2R1bGVzXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm4gPSBmdW5jdGlvbihtb2R1bGUpIHtcbiBcdFx0dmFyIGdldHRlciA9IG1vZHVsZSAmJiBtb2R1bGUuX19lc01vZHVsZSA/XG4gXHRcdFx0ZnVuY3Rpb24gZ2V0RGVmYXVsdCgpIHsgcmV0dXJuIG1vZHVsZVsnZGVmYXVsdCddOyB9IDpcbiBcdFx0XHRmdW5jdGlvbiBnZXRNb2R1bGVFeHBvcnRzKCkgeyByZXR1cm4gbW9kdWxlOyB9O1xuIFx0XHRfX3dlYnBhY2tfcmVxdWlyZV9fLmQoZ2V0dGVyLCAnYScsIGdldHRlcik7XG4gXHRcdHJldHVybiBnZXR0ZXI7XG4gXHR9O1xuXG4gXHQvLyBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGxcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubyA9IGZ1bmN0aW9uKG9iamVjdCwgcHJvcGVydHkpIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3QsIHByb3BlcnR5KTsgfTtcblxuIFx0Ly8gX193ZWJwYWNrX3B1YmxpY19wYXRoX19cbiBcdF9fd2VicGFja19yZXF1aXJlX18ucCA9IFwiXCI7XG5cblxuIFx0Ly8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4gXHRyZXR1cm4gX193ZWJwYWNrX3JlcXVpcmVfXyhfX3dlYnBhY2tfcmVxdWlyZV9fLnMgPSBcIi4vc3JjL2FwcC50c1wiKTtcbiIsImltcG9ydCB7IEdyaWQgfSBmcm9tIFwiLi9ncmlkXCI7XHJcblxyXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImxvYWRcIiwgZnVuY3Rpb24gKCkge1xyXG5cclxuICAgIGxldCBwaWNrZXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImZpbGVwaWNrZXJcIikgYXMgSFRNTElucHV0RWxlbWVudDtcclxuXHJcbiAgICBpZiAoIXBpY2tlcikge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKFwicGlja2VyIGVycm9yXCIpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgY2FudmFzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJjYW52YXNcIikgYXMgSFRNTENhbnZhc0VsZW1lbnQ7XHJcblxyXG4gICAgaWYgKCFjYW52YXMpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGN0eDogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEID0gY2FudmFzLmdldENvbnRleHQoXCIyZFwiKSBhcyBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQ7XHJcbiAgICBpZiAoIWN0eCkgcmV0dXJuO1xyXG5cclxuICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYmEoMjU1LDI1NSwyNTUsMSlcIlxyXG4gICAgY3R4LmZpbGxSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7XHJcblxyXG4gICAgbGV0IGdyaWQ6IEdyaWQgPSBuZXcgR3JpZChjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQsIDUyKTtcclxuICAgIGdyaWQuc2V0UGFkZGluZygzMCk7XHJcbiAgICBncmlkLnNldENvbG9yKDB4ZmYzMzMzMzMpO1xyXG4gICAgZ3JpZC5zZXRTdHJva2VXaWR0aCgwLjUpO1xyXG4gICAgLy8gZ3JpZC5kcmF3KGN0eCk7XHJcbiAgICBncmlkLmRyYXdXaXRob3VkUmVwZWF0KGN0eCk7XHJcblxyXG4gICAgcGlja2VyLmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgZnVuY3Rpb24gKCkge1xyXG4gICAgICAgIGlmIChwaWNrZXIuZmlsZXMpIHtcclxuICAgICAgICAgICAgbGV0IGZyOiBGaWxlUmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcclxuICAgICAgICAgICAgZnIub25sb2FkID0gKGUxKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBsZXQgaSA9IG5ldyBJbWFnZSgpO1xyXG4gICAgICAgICAgICAgICAgaS5vbmxvYWQgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY3R4LmZpbGxSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY3R4LmRyYXdJbWFnZShpLCAwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGdyaWQuZHJhd1dpdGhvdWRSZXBlYXQoY3R4KTtcclxuXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpLnNyYyA9IGZyLnJlc3VsdCBhcyBzdHJpbmc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZnIucmVhZEFzRGF0YVVSTChwaWNrZXIuZmlsZXNbMF0pO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuXHJcbn0sIGZhbHNlKTtcclxuXHJcblxyXG5cclxuIiwiZXhwb3J0IGNsYXNzIENvbG9yIHtcclxuXHJcbiAgICBwcml2YXRlIHZhbHVlOiBudW1iZXI7XHJcblxyXG4gICAgY29uc3RydWN0b3IodmFsdWU6IG51bWJlciA9IDApIHtcclxuICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWU7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldENvbG9yKCk6IG51bWJlciB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMudmFsdWU7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHN0YXRpYyB0b0FyZ2JTdHJpbmcodmFsdWU6IG51bWJlcik6IHN0cmluZyB7XHJcbiAgICAgICAgcmV0dXJuIFwicmdiYShcIiArIENvbG9yLnJlZCh2YWx1ZSkgKyBcIixcIiArIENvbG9yLmdyZWVuKHZhbHVlKSArIFwiLFwiICsgQ29sb3IuYmx1ZSh2YWx1ZSkgKyBcIixcIiArIENvbG9yLmFscGhhKHZhbHVlKSAvIDI1NSArIFwiKVwiO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzdGF0aWMgYWxwaGEodmFsdWU6IG51bWJlcik6IG51bWJlciB7XHJcbiAgICAgICAgcmV0dXJuICgodmFsdWUgPj4gMjQpICYgMHhmZik7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHN0YXRpYyByZWQodmFsdWU6IG51bWJlcik6IG51bWJlciB7XHJcbiAgICAgICAgcmV0dXJuICgodmFsdWUgPj4gMTYpICYgMHhmZik7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHN0YXRpYyBncmVlbih2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgICAgICByZXR1cm4gKCh2YWx1ZSA+PiA4KSAmIDB4ZmYpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzdGF0aWMgYmx1ZSh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgICAgICByZXR1cm4gKHZhbHVlICYgMHhmZik7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHN0YXRpYyBtYWtlKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGE6IG51bWJlciA9IDI1NSk6IENvbG9yIHtcclxuICAgICAgICByZXR1cm4gbmV3IENvbG9yKCgoYSAmIDB4ZmYpIDw8IDI0KSB8ICgociAmIDB4ZmYpIDw8IDE2KSB8ICgoZyAmIDB4ZmYpIDw8IDgpIHwgKGIgJiAweGZmKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHN0YXRpYyBtYWtlR3JheSh2OiBudW1iZXIpOiBDb2xvciB7XHJcbiAgICAgICAgcmV0dXJuIENvbG9yLm1ha2Uodiwgdiwgdik7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHN0YXRpYyByYW5kb20oKTogQ29sb3Ige1xyXG4gICAgICAgIGxldCByOiBudW1iZXIgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAweGZmKTtcclxuICAgICAgICBsZXQgZzogbnVtYmVyID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMHhmZik7XHJcbiAgICAgICAgbGV0IGI6IG51bWJlciA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDB4ZmYpO1xyXG4gICAgICAgIHJldHVybiBDb2xvci5tYWtlKHIsIGcsIGIpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzdGF0aWMgcmFuZG9tR3JheSgpOiBDb2xvciB7XHJcbiAgICAgICAgcmV0dXJuIENvbG9yLm1ha2VHcmF5KE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDB4ZmYpKTtcclxuICAgIH1cclxufSIsImltcG9ydCB7IENvbG9yIH0gZnJvbSBcIi4vY29sb3JcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBHcmlkIHtcclxuXHJcbiAgICBwcml2YXRlIHdpZHRoOiBudW1iZXI7XHJcbiAgICBwcml2YXRlIGhlaWdodDogbnVtYmVyO1xyXG4gICAgcHJpdmF0ZSByYWRpdXM6IG51bWJlcjtcclxuICAgIHByaXZhdGUgY29sb3I6IG51bWJlcjtcclxuICAgIHByaXZhdGUgc3Ryb2tlV2lkdGg6IG51bWJlciA9IDE7XHJcbiAgICBwcml2YXRlIHBhZGRpbmc6IG51bWJlciA9IDA7XHJcblxyXG4gICAgY29uc3RydWN0b3IodzogbnVtYmVyLCBoOiBudW1iZXIsIHI6IG51bWJlciA9IDUwLCBjOiBudW1iZXIgPSAweDQ0MzMzMzMzKSB7XHJcbiAgICAgICAgdGhpcy53aWR0aCA9IHc7XHJcbiAgICAgICAgdGhpcy5oZWlnaHQgPSBoO1xyXG4gICAgICAgIHRoaXMucmFkaXVzID0gcjtcclxuICAgICAgICB0aGlzLmNvbG9yID0gYztcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZHJhdyhjYW52YXM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCk6IHZvaWQge1xyXG5cclxuICAgICAgICBjYW52YXMuc2F2ZSgpO1xyXG4gICAgICAgIGNhbnZhcy5zdHJva2VTdHlsZSA9IENvbG9yLnRvQXJnYlN0cmluZyh0aGlzLmNvbG9yKTtcclxuICAgICAgICBjYW52YXMubGluZVdpZHRoID0gdGhpcy5zdHJva2VXaWR0aDtcclxuICAgICAgICBjYW52YXMuaW1hZ2VTbW9vdGhpbmdFbmFibGVkID0gZmFsc2U7XHJcblxyXG4gICAgICAgIGxldCBoOiBudW1iZXIgPSAodGhpcy5yYWRpdXMgKiBNYXRoLnNxcnQoMykpIC8gMjtcclxuICAgICAgICBsZXQgcjogbnVtYmVyID0gdGhpcy5yYWRpdXM7XHJcblxyXG4gICAgICAgIGxldCBocyA9IGggKiAyXHJcbiAgICAgICAgbGV0IHZzID0gciAqIDEuNTtcclxuXHJcbiAgICAgICAgbGV0IHN3OiBudW1iZXIgPSBNYXRoLmZsb29yKCh0aGlzLndpZHRoIC0gKHRoaXMucGFkZGluZyAqIDIpKSAvIGhzKTtcclxuICAgICAgICBsZXQgc2g6IG51bWJlciA9IE1hdGguZmxvb3IoKHRoaXMuaGVpZ2h0IC0gKHRoaXMucGFkZGluZyAqIDIpKSAvIHZzKTtcclxuXHJcbiAgICAgICAgbGV0IHB4ID0gKHRoaXMud2lkdGggLSAoaHMgKiBzdykpIC8gMjtcclxuICAgICAgICBsZXQgcHkgPSAodGhpcy5oZWlnaHQgLSAodnMgKiBzaCkpIC8gMjtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coXCJHcmlkczpcIiArIChzdyAqIHNoIC0gKChzaCAtIDEpIC8gMikpKTtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBzaDsgaisrKSB7XHJcblxyXG4gICAgICAgICAgICBsZXQgc3d4ID0gc3c7XHJcbiAgICAgICAgICAgIGxldCBvZmYgPSAwO1xyXG4gICAgICAgICAgICBpZiAoaiAlIDIgPT0gMSkge1xyXG4gICAgICAgICAgICAgICAgb2ZmICs9IGg7XHJcbiAgICAgICAgICAgICAgICBzd3ggPSBzdyAtIDE7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc3d4OyBpKyspIHtcclxuXHJcbiAgICAgICAgICAgICAgICBsZXQgY3g6IG51bWJlciA9IHB4ICsgaHMgLyAyICsgaSAqIGhzICsgb2ZmO1xyXG4gICAgICAgICAgICAgICAgbGV0IGN5OiBudW1iZXIgPSBweSArIHZzIC8gMiArIGogKiB2cztcclxuXHJcbiAgICAgICAgICAgICAgICBjYW52YXMuYmVnaW5QYXRoKCk7XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgYSA9IDA7IGEgPCA2OyBhKyspIHtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IGFuZ2xlOiBudW1iZXIgPSB0aGlzLnJhZGlhbnMoYSAqIDYwICsgOTApO1xyXG4gICAgICAgICAgICAgICAgICAgIGxldCB4OiBudW1iZXIgPSAoY3ggKyBNYXRoLmNvcyhhbmdsZSkgKiByKTtcclxuICAgICAgICAgICAgICAgICAgICBsZXQgeTogbnVtYmVyID0gKGN5ICsgTWF0aC5zaW4oYW5nbGUpICogcik7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGEgPT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYW52YXMubW92ZVRvKHgsIHkpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5saW5lVG8oeCwgeSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY2FudmFzLmNsb3NlUGF0aCgpO1xyXG4gICAgICAgICAgICAgICAgY2FudmFzLnN0cm9rZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNhbnZhcy5yZXN0b3JlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGRyYXdXaXRob3VkUmVwZWF0KGNhbnZhczogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKTogdm9pZCB7XHJcblxyXG4gICAgICAgIGNhbnZhcy5zYXZlKCk7XHJcbiAgICAgICAgY2FudmFzLnN0cm9rZVN0eWxlID0gQ29sb3IudG9BcmdiU3RyaW5nKHRoaXMuY29sb3IpO1xyXG4gICAgICAgIGNhbnZhcy5saW5lV2lkdGggPSB0aGlzLnN0cm9rZVdpZHRoO1xyXG4gICAgICAgIGNhbnZhcy5pbWFnZVNtb290aGluZ0VuYWJsZWQgPSBmYWxzZTtcclxuXHJcbiAgICAgICAgbGV0IGg6IG51bWJlciA9ICh0aGlzLnJhZGl1cyAqIE1hdGguc3FydCgzKSkgLyAyO1xyXG4gICAgICAgIGxldCByOiBudW1iZXIgPSB0aGlzLnJhZGl1cztcclxuXHJcbiAgICAgICAgbGV0IGhzID0gaCAqIDJcclxuICAgICAgICBsZXQgdnMgPSByICogMS41O1xyXG5cclxuICAgICAgICBsZXQgc3c6IG51bWJlciA9IE1hdGguZmxvb3IoKHRoaXMud2lkdGggLSAodGhpcy5wYWRkaW5nICogMikpIC8gaHMpO1xyXG4gICAgICAgIGxldCBzaDogbnVtYmVyID0gTWF0aC5mbG9vcigodGhpcy5oZWlnaHQgLSAodGhpcy5wYWRkaW5nICogMikpIC8gdnMpO1xyXG5cclxuICAgICAgICBsZXQgcHggPSAodGhpcy53aWR0aCAtIChocyAqIHN3KSkgLyAyO1xyXG4gICAgICAgIGxldCBweSA9ICh0aGlzLmhlaWdodCAtICh2cyAqIHNoKSkgLyAyO1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhcIkdyaWRzOlwiICsgKHN3ICogc2ggLSAoKHNoIC0gMSkgLyAyKSkpO1xyXG5cclxuICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IHNoICsgMTsgaisrKSB7XHJcblxyXG4gICAgICAgICAgICBsZXQgZCA9IDE7XHJcbiAgICAgICAgICAgIGxldCBzd3ggPSBzdztcclxuICAgICAgICAgICAgaWYgKGogJSAyID09IDEpIHtcclxuICAgICAgICAgICAgICAgIHN3eCA9IHN3O1xyXG4gICAgICAgICAgICAgICAgZCA9IC0xO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxldCBseCA9IDA7XHJcbiAgICAgICAgICAgIGxldCBseSA9IDA7XHJcblxyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHN3eCAqIDIgKyAxOyBpKyspIHtcclxuXHJcbiAgICAgICAgICAgICAgICBsZXQgY3g6IG51bWJlciA9IHB4ICsgaSAqIGhzIC8gMjtcclxuICAgICAgICAgICAgICAgIGxldCBjeTogbnVtYmVyID0gcHkgKyB2cyAvIDIgKyBqICogdnM7XHJcblxyXG4gICAgICAgICAgICAgICAgbGV0IHg6IG51bWJlciA9IGN4O1xyXG4gICAgICAgICAgICAgICAgbGV0IHk6IG51bWJlciA9IGN5IC0gciAvIDIgKyAoaiAlIDIgPT0gMSA/IChpICUgMiA9PSAxID8gMCA6IGQgKiByIC8gMikgOiAoaSAlIDIgPT0gMCA/IDAgOiBkICogLXIgLyAyKSk7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGkgIT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChqID09IHNoICYmIChpID09IDEgfHwgaSA9PSBzd3ggKiAyKSAmJiBqICUgMiA9PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNwZWNpYWwgY2FzZSA6KVxyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5iZWdpblBhdGgoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2FudmFzLm1vdmVUbyhseCwgbHkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYW52YXMubGluZVRvKHgsIHkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYW52YXMuc3Ryb2tlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpICUgMiA9PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGogIT0gc2gpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGogJSAyID09IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5iZWdpblBhdGgoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5tb3ZlVG8oeCwgeSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW52YXMubGluZVRvKHgsIHkgKyByKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5zdHJva2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmKGkgIT0gc3d4KjIpe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FudmFzLmJlZ2luUGF0aCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FudmFzLm1vdmVUbyh4ICsgaHMgLyAyLCB5ICsgciAvIDIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FudmFzLmxpbmVUbyh4ICsgaHMgLyAyLCB5ICsgciArIHIgLyAyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5zdHJva2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGx4ID0geDtcclxuICAgICAgICAgICAgICAgIGx5ID0geTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBjYW52YXMucmVzdG9yZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzZXRQYWRkaW5nKHBhZGRpbmc6IG51bWJlcik6IHZvaWQge1xyXG4gICAgICAgIHRoaXMucGFkZGluZyA9IHBhZGRpbmc7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHNldENvbG9yKGNvbG9yOiBudW1iZXIpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLmNvbG9yID0gY29sb3I7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHNldFN0cm9rZVdpZHRoKHdpZHRoOiBudW1iZXIpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLnN0cm9rZVdpZHRoID0gd2lkdGg7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHByaXZhdGUgcmFkaWFucyhkZWdyZWVzOiBudW1iZXIpOiBudW1iZXIge1xyXG4gICAgICAgIHJldHVybiBkZWdyZWVzICogTWF0aC5QSSAvIDE4MDtcclxuICAgIH1cclxuXHJcbn0iXSwic291cmNlUm9vdCI6IiJ9