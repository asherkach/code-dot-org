/* global AudioContext */

/**
 * Interface for a sound registry and playback mechanism
 * @interface AudioPlayer
 */
function AudioPlayer() {}

/**
 * Register a sound to a given ID
 *
 * @function
 * @name AudioPlayer#register
 * @param {Object} options
 * @param {string} options.id the sound ID for playback
 * @param {string} [options.mp3] path to mp3 file
 * @param {string} [options.ogg] path to ogg file
 * @param {string} [options.wav] path to wav file
 */

/**
 * Attempt to play back a sound with a given ID (if exists)
 *
 * @function
 * @name AudioPlayer#play
 * @param {string} soundId - Name of the sound to play
 * @param {Object} [options]
 * @param {number} [options.volume] default 1.0, which is "no change"
 * @param {boolean} [options.loop] default false
 * @param {function} [options.onEnded]
 */

/**
 * Simple registry for cross-browser sound effect playback.
 * Will play sounds using Web Audio or HTML5 Audio element where available.
 *
 * Based off of blockly-core's sound loading in blockly-core/core/blockly.js
 *
 * Usage:
 *   var mySounds = new Sounds();
 *   mySounds.register({id: 'myFirstSound', ogg: '/mysound.ogg', mp3: '/mysound.mp3'});
 *   mySounds.play('myFirstSound');
 * @constructor
 * @implements AudioPlayer
 */
function Sounds() {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;

  this.audioContext = null;

  /**
   * Detect whether audio system is "unlocked" - it usually works immediately
   * on dekstop, but mobile usually restricts audio until triggered by user.
   * @private {boolean}
   */
  this.audioUnlocked_ = false;

  if (window.AudioContext) {
    try {
      this.audioContext = new AudioContext();
      this.initializeAudioUnlockState_();
    } catch (e) {
      /**
       * Chrome occasionally chokes on creating singleton AudioContext instances in separate tabs
       * when iframes are open, potentially related to:
       *    https://code.google.com/p/chromium/issues/detail?id=308784
       * or https://code.google.com/p/chromium/issues/detail?id=160022
       *
       * In the Chrome case, this will fall-back to the `window.Audio` method
       */
    }
  }

  this.soundsById = {};
}

/**
 * Plays a silent sound to check whether audio is unlocked (usable) in the
 * current browser.
 * On mobile, our initial audio unlock will fail because unlocking audio
 * requires user interaction.  In that case, we add a handler to catch
 * the first user interaction and try unlocking audio again.
 * @private
 */
Sounds.prototype.initializeAudioUnlockState_ = function () {
  this.unlockAudio(function () {
    if (this.isAudioUnlocked()) {
      return;
    }
    var unlockHandler = function () {
      this.unlockAudio(function () {
        if (this.isAudioUnlocked()) {
          document.removeEventListener("mousedown", unlockHandler, true);
          document.removeEventListener("touchend", unlockHandler, true);
        }
      }.bind(this));
    }.bind(this);
    document.addEventListener("mousedown", unlockHandler, true);
    document.addEventListener("touchend", unlockHandler, true);
  }.bind(this));
};

/**
 * Whether we're allowed to play audio by the browser yet.
 * @returns {boolean}
 */
Sounds.prototype.isAudioUnlocked = function () {
  // Audio unlock doesn't make sense for the fallback player as used here.
  return this.audioUnlocked_ || !this.audioContext;
};

/**
 * Mobile browsers disable audio until a sound is triggered by user interaction.
 * This method tries to play a brief silent clip to test whether audio is
 * unlocked, and/or trigger an unlock if called inside a user interaction.
 *
 * Special thanks to this article for the general approach:
 * https://paulbakaus.com/tutorials/html5/web-audio-on-ios/
 *
 * @param {function} [onComplete] callback for after we've checked whether
 *        audio was unlocked successfully.
 */
Sounds.prototype.unlockAudio = function (onComplete) {
  if (this.isAudioUnlocked()) {
    return;
  }

  // create empty buffer and play it
  var buffer = this.audioContext.createBuffer(1, 1, 22050);
  var source = this.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(this.audioContext.destination);
  if (source.start) {
    source.start(0);
  } else {
    source.noteOn(0);
  }

  setTimeout(function () {
    if (source.playbackState === source.PLAYING_STATE ||
        source.playbackState === source.FINISHED_STATE) {
      this.audioUnlocked_ = true;
    }
    if (onComplete) {
      onComplete();
    }
  }.bind(this), 0);
};

/**
 * Registers a sound from a list of sound URL paths.
 * Note: you can only register one sound resource per file type
 * @param {Array.<string>} soundPaths list of sound file URLs ending in their
 *                                   file format (.mp3|.ogg|.wav)
 * @param {string} soundID ID for sound
 * @returns {Sound}
 */
Sounds.prototype.registerByFilenamesAndID = function (soundPaths, soundID) {
  var soundRegistrationConfig = { id: soundID };
  for (var i = 0; i < soundPaths.length; i++) {
    var soundFilePath = soundPaths[i];
    var getExtensionRegexp = /\.(\w+)(\?.*)?$/;
    var extensionCaptureGroups = soundFilePath.match(getExtensionRegexp);
    if (extensionCaptureGroups) {
      // Extend soundRegistrationConfig with format options
      // so e.g. soundRegistrationConfig['mp3'] = 'file.mp3'
      var extension = extensionCaptureGroups[1];
      soundRegistrationConfig[extension] = soundFilePath;
    }
  }
  return this.register(soundRegistrationConfig);
};

/**
 * @param {Object} config
 * @returns {Sound}
 */
Sounds.prototype.register = function (config) {
  var sound = new Sound(config, this.audioContext);
  this.soundsById[config.id] = sound;
  sound.preload();
  return sound;
};

/**
 * @param {string} soundId - Name of the sound to play
 * @param {Object} [options]
 * @param {number} [options.volume] default 1.0, which is "no change"
 * @param {boolean} [options.loop] default false
 * @param {function} [options.onEnded]
 */
Sounds.prototype.play = function (soundId, options) {
  var sound = this.soundsById[soundId];
  if (sound) {
    sound.play(options);
  }
};

Sounds.prototype.playURL = function (url, playbackOptions) {
  // Play a sound given a URL, register it using the URL as id and infer
  // the file type from the extension at the end of the URL
  // (NOTE: not ideal because preload happens inside first play)
  var sound = this.soundsById[url];
  if (sound) {
    sound.play(playbackOptions);
  } else {
    var soundConfig = {id: url};
    var ext = Sounds.getExtensionFromUrl(url);
    soundConfig[ext] = url;
    // Force HTML5 audio if the caller requests it (cross-domain origin issues)
    soundConfig.forceHTML5 = playbackOptions && playbackOptions.forceHTML5;
    // Force HTML5 audio on mobile if the caller requests it
    soundConfig.allowHTML5Mobile = playbackOptions && playbackOptions.allowHTML5Mobile;
    // since preload may be async, we set playAfterLoad in the config so we
    // play the sound once it is loaded
    // Also stick the playbackOptions inside the config as playAfterLoadOptions
    soundConfig.playAfterLoad = true;
    soundConfig.playAfterLoadOptions = playbackOptions;
    this.register(soundConfig);
  }
};

Sounds.prototype.stopLoopingAudio = function (soundId) {
  var sound = this.soundsById[soundId];
  sound.stop();
};

Sounds.prototype.get = function (soundId) {
  return this.soundsById[soundId];
};

Sounds.getExtensionFromUrl = function (url) {
  return url.substr(url.lastIndexOf('.') + 1);
};

/**
 * Initialize an individual sound
 * @param config available sound files for this audio
 * @param audioContext context this sound can be played on, or null if none
 * @constructor
 */
function Sound(config, audioContext) {
  this.config = config;
  this.audioContext = audioContext;
  this.audioElement = null; // if HTML5 Audio
  this.reusableBuffer = null; // if Web Audio
  this.playableBuffer = null; // if Web Audio
}

/**
 * @param {Object} [options]
 * @param {number} [options.volume] default 1.0, which is "no change"
 * @param {boolean} [options.loop] default false
 * @param {function} [options.onEnded]
 */
Sound.prototype.play = function (options) {
  options = options || {};
  if (!this.audioElement && !this.reusableBuffer) {
    return;
  }

  if (this.reusableBuffer) {
    this.playableBuffer = this.newPlayableBufferSource(this.reusableBuffer, options);

    // Hook up on-ended callback, although browser support may be limited.
    // Don't make anything depend on this callback happening.
    if (options.onEnded) {
      this.playableBuffer.onended = options.onEnded;
    }

    // Play sound, supporting older versions of the Web Audio API which used noteOn(Off).
    if (this.playableBuffer.start) {
      this.playableBuffer.start(0);
    } else {
      this.playableBuffer.noteOn(0);
    }
    return;
  }

  if (!this.config.allowHTML5Mobile && isMobile()) {
    // Don't play HTML 5 audio on mobile
    return;
  }

  var volume = (typeof options.volume === "undefined") ? 1 : 
      Math.max(0, Math.min(1, options.volume));
  this.audioElement.volume = volume;
  this.audioElement.loop = !!options.loop;
  if (options.onEnded) {
    var unregisterAndCallback = function () {
      this.audioElement.removeEventListener('abort', unregisterAndCallback);
      this.audioElement.removeEventListener('ended', unregisterAndCallback);
      this.audioElement.removeEventListener('pause', unregisterAndCallback);
      options.onEnded();
    }.bind(this);
    this.audioElement.addEventListener('abort', unregisterAndCallback);
    this.audioElement.addEventListener('ended', unregisterAndCallback);
    this.audioElement.addEventListener('pause', unregisterAndCallback);
  }
  this.audioElement.play();
};

Sound.prototype.stop = function () {
  try {
    if (this.playableBuffer) {
      if (this.playableBuffer.stop) {  // Newest web audio pseudo-standard.
        this.playableBuffer.stop(0);
      } else if (this.playableBuffer.noteOff) {  // Older web audio.
        this.playableBuffer.noteOff(0);
      }
    } else if (this.audioElement) {
      // html 5 audio.
      this.audioElement.pause();
    }
  } catch (e) {
    if (e.name === 'InvalidStateError') {
      // Stopping a sound that hasn't been played.
    } else {
      throw e;
    }
  }
};

Sound.prototype.newPlayableBufferSource = function(buffer, options) {
  var newSound = this.audioContext.createBufferSource();

  // Older versions of chrome call this createGainNode instead of createGain
  if (this.audioContext.createGain) {
    this.gainNode = this.audioContext.createGain();
  } else if (this.audioContext.createGainNode) {
    this.gainNode = this.audioContext.createGainNode();
  } else {
    return null;
  }

  newSound.buffer = buffer;
  newSound.loop = !!options.loop;
  newSound.connect(this.gainNode);
  this.gainNode.connect(this.audioContext.destination);
  var startingVolume = typeof options.volume === "undefined" ? 1 : options.volume;
  this.gainNode.gain.value = startingVolume;
  return newSound;
};

/**
 * Do an exponential fade from the current gain to a new given value, over the
 * given number of seconds.
 * @param {number} gain - desired final gain value
 * @param {number} durationSeconds
 */
Sound.prototype.fadeToGain = function (gain, durationSeconds) {
  if (this.gainNode) {
    this.fadeToGainWebAudio_(gain, durationSeconds);
  } else if (this.audioElement) {
    this.fadeToGainHtml5Audio_(gain, durationSeconds);
  }
};

/**
 * Do an exponential fade from the current gain to a new given value, over the
 * given number of seconds.
 * Using Web Audio (preferred, but not supported in IE)
 * @param {number} gain - desired final gain value
 * @param {number} durationSeconds
 * @private
 */
Sound.prototype.fadeToGainWebAudio_ = function (gain, durationSeconds) {
  if (!this.gainNode) {
    return;
  }

  // Can't exponential ramp to zero, simulate by getting close.
  if (gain === 0) {
    gain = 0.01;
  }

  var currTime = this.audioContext.currentTime;
  this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currTime);
  this.gainNode.gain.exponentialRampToValueAtTime(gain, currTime + durationSeconds);
};

/**
 * Do an exponential fade from the current gain to a new given value, over the
 * given number of seconds.
 * Using HTML5 Audio (fallback player)
 * @param {number} gain - desired final gain value
 * @param {number} durationSeconds
 * @private
 */
Sound.prototype.fadeToGainHtml5Audio_ = function (gain, durationSeconds) {
  if (!this.audioElement) {
    return;
  }

  var startVolume = this.audioElement.volume || 1;
  var finalVolume = Math.max(0, Math.min(1, gain));
  var deltaVolume = finalVolume - startVolume;
  var durationMillis = durationSeconds * 1000;
  var t0 = new Date().getTime();
  var fadeInterval = setInterval(function () {
    var t = new Date().getTime() - t0;

    // Base condition - after duration has elapsed, snap volume to final and
    // clear interval
    if (t >= durationMillis) {
      this.audioElement.volume = finalVolume;
      clearInterval(fadeInterval);
      return;
    }

    // TODO: Probably ought to use ease out quad if delta is positive,
    // TODO: so that cross-fades automatically work as expected.
    // Ease in quad - the ear hears this as a "linear" fade
    // y = c * (t/d)^2 + b
    //   b: initial value
    //   c: final delta
    //   d: duration
    //   t: time
    var newVolume = deltaVolume * Math.pow(t / durationMillis, 2) + startVolume;
    this.audioElement.volume = Math.max(0, Math.min(1, newVolume));
  }.bind(this), 100);
};

function isMobile() {
  return ('ontouchstart' in document.documentElement);
}

function isIE9() {
  /** @type {number} */
  var version = -1;

  if (/MSIE\s([\d.]+)/.test(navigator.userAgent)) {
    version = parseInt(RegExp.$1);
  }

  return version === 9;
}

Sound.prototype.getPlayableFile = function () {
  // IE9 Running on Windows Server SKU can throw an exception on window.Audio
  try {
    if (!window.Audio) {
      return false;
    }

    var audioTest = new window.Audio();

    if (this.config.hasOwnProperty('mp3') && audioTest.canPlayType('audio/mp3')) {
      return this.config.mp3;
    }
    if (this.config.hasOwnProperty('ogg') && audioTest.canPlayType('audio/ogg')) {
      return this.config.ogg;
    }
    if (this.config.hasOwnProperty('wav') && audioTest.canPlayType('audio/wav')) {
      return this.config.wav;
    }
  } catch(e) {

  }

  return false;
};

Sound.prototype.preload = function () {
  var file = this.getPlayableFile();
  if (!file) {
    return;
  }

  if (!this.config.forceHTML5 && window.AudioContext && this.audioContext) {
    var self = this;
    this.preloadViaWebAudio(file, function (buffer) {
      self.reusableBuffer = buffer;
    });
    return;
  }

  if (window.Audio) {
    var audioElement = new window.Audio(file);
    if (!audioElement || !audioElement.play) {
      return;
    }

    if (!isIE9()) {
      // Pre-cache audio
      audioElement.play();
      audioElement.pause();
    }
    this.audioElement = audioElement;

    // Fire onLoad as soon as enough of the sound is loaded to play it
    // all the way through.
    var loadEventName = 'canplaythrough';
    var eventListener = function () {
      this.onSoundLoaded();
      audioElement.removeEventListener(loadEventName, eventListener);
    }.bind(this);
    audioElement.addEventListener(loadEventName, eventListener);
  }
};

Sound.prototype.onSoundLoaded = function () {
  if (this.config.playAfterLoad) {
    this.play(this.config.playAfterLoadOptions);
  }
  if (this.onLoad) {
    this.onLoad();
  }
};

Sound.prototype.preloadViaWebAudio = function (filename, onPreloadedCallback) {
  var request = new XMLHttpRequest();
  request.open('GET', filename, true);
  request.responseType = 'arraybuffer';
  var self = this;
  request.onload = function () {
    self.audioContext.decodeAudioData(request.response, function (buffer) {
      onPreloadedCallback(buffer);
      self.onSoundLoaded();
    });
  };
  request.send();
};
