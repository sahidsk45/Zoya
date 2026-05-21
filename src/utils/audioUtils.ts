export async function playPCM(base64Data: string): Promise<void> {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("AudioContext not supported");
      return;
    }
    const audioCtx = new AudioContextClass();

    // Auto-resume AudioContext in case of browser autoplay policy suspensions
    if (audioCtx.state === "suspended") {
      await audioCtx.resume().catch(err => console.warn("Failed to resume AudioContext:", err));
    }

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;

    let audioBuffer: AudioBuffer;
    try {
      // Decode compressed format (e.g. MP3, AAC, WAV) returned by the Gemini TTS engine
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    } catch (decodeError) {
      console.warn("decodeAudioData failed, falling back to manual PCM decoding", decodeError);
      
      // Fallback: decode raw 16-bit PCM at 24000Hz manually using DataView for alignment immunity
      const dataView = new DataView(arrayBuffer);
      const numSamples = Math.floor(arrayBuffer.byteLength / 2);
      audioBuffer = audioCtx.createBuffer(1, numSamples, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start();
    
    return new Promise<void>(resolve => {
      source.onended = () => {
        audioCtx.close().catch(() => {});
        resolve();
      };
    });
  } catch (error) {
    console.error("Error playing audio:", error);
  }
}
