export class LocalMedia {
  constructor(opts) {
    let defaults = {
      onstreamchange: (stream) => null,
      ondevicechange: () => null,
      audioDevices: [],
      videoDevices: [],
      outputDevices: [],
      audioSource: undefined,
      videoSource: undefined,
      audioEnabled: true,
      videoEnabled: true,
      stream: undefined,
    };
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (opts.hasOwnProperty(key)) {
        this[key] = opts[key];
      } else {
        this[key] = defaultValue;
      }
    }
    this.updateStream();
    this.updateDevices();
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => this.updateDevices());
    }
  }

  setAudioSource(deviceId) {
    this.audioSource = deviceId;
    this.updateStream();
  }

  setVideoSource(deviceId) {
    this.videoSource = deviceId;
    this.updateStream();
  }

  toggleAudio() {
    this.audioEnabled = !this.audioEnabled;
    this.updateStream();
  }

  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.updateStream();
  }

  shareScreen() {
    this.setVideoSource('screen');
  }

  async updateStream() {
    if (navigator.mediaDevices) {
      if (this.videoSource === 'screen') {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          audio: {deviceId: true},
          video: {deviceId: true},
          systemAudio: 'include',
        });
      } else {
        const source = (src) => {
          if (src === false) {
            return false;
          }
          return {deviceId: src ? {exact: src} : true};
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: source(this.audioSource),
          video: source(this.videoSource),
        });
      }
    }
    if (!this.audioEnabled) {
      for (const track of this.stream.getAudioTracks()) {
        track.enabled = false;
      }
    }
    if (!this.videoEnabled) {
      for (const track of this.stream.getVideoTracks()) {
        track.enabled = false;
      }
    }
    if (this.onstreamchange) {
      this.onstreamchange(this.stream);
    }
  }

  async updateDevices() {
    const devices = navigator.mediaDevices ? await navigator.mediaDevices.enumerateDevices() : [];
    this.audioDevices = devices.filter(({kind}) => kind === "audioinput");
    this.videoDevices = devices.filter(({kind}) => kind === "videoinput");
    this.outputDevices = devices.filter(({kind}) => kind === "audiooutput");
    if (this.ondevicechange) {
      this.ondevicechange();
    }
  }
}
