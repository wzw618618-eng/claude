// ZzFX 没带类型声明，这里只写用到的部分
declare module 'zzfx' {
  export function zzfx(...params: (number | undefined)[]): AudioBufferSourceNode;
  export const ZZFX: { volume: number; audioContext: AudioContext };
}
declare module 'mainloop.js' {
  interface Loop {
    setSimulationTimestep(ms: number): Loop;
    setUpdate(f: (delta: number) => void): Loop;
    setDraw(f: (interp: number) => void): Loop;
    setEnd(f: (fps: number, panic: boolean) => void): Loop;
    resetFrameDelta(): number;
    start(): Loop;
    stop(): Loop;
    isRunning(): boolean;
  }
  const MainLoop: Loop;
  export default MainLoop;
}
