export class Session {
  constructor(url) {
    this.signals = new WebSocket(url);
    this.peer = new RTCPeerConnection();
    this.peer.onicecandidate = e => {
      if (!e.candidate) return;
      this.signals.send(JSON.stringify({event: 'candidate', data: JSON.stringify(e.candidate)}));
    };
    this.signals.onmessage = e => {
      const signal = JSON.parse(e.data);
      if (!signal) {
        console.error('failed to parse signal');
        return;
      }

      switch (signal.event) {
        case 'offer':
          const offer = JSON.parse(signal.data);
          if (!offer) {
            console.error('failed to parse answer');
            return;
          }
          this.peer.setRemoteDescription(offer);
          this.peer.createAnswer().then(answer => {
            this.peer.setLocalDescription(answer);
            this.signals.send(JSON.stringify({event: 'answer', data: JSON.stringify(answer)}));
          });
          return;

        case 'candidate':
          const candidate = JSON.parse(signal.data);
          if (!candidate) {
            console.error('failed to parse candidate');
            return;
          }
          this.peer.addIceCandidate(candidate);
          return;
      }
    }
  }


  setTrack(track, stream) {
    const sender = this.peer.getSenders().find((s) => s.track && s.track.kind == track.kind);
    if (sender) {
      sender.replaceTrack(track);
    } else {
      this.peer.addTrack(track, stream);
    }
  }

  setStream(stream) {
    for (const track of stream.getVideoTracks()) {
      this.setTrack(track, stream);
      break; // send at most one video track
    }
    for (const track of stream.getAudioTracks()) {
      this.setTrack(track, stream);
      break; // send at most one audio track
    }
  }

  set ontrack(fn) { this.peer.ontrack = fn; }
  set onerror(fn) { this.signals.onerror = fn; }
  set onclose(fn) { this.signals.onclose = fn; }

  close() {
    if (this.signals) {
      this.signals.close();
      this.signals = null;
    }
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
  }
}
