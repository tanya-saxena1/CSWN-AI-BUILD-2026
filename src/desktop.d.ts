export {};
declare global {
  interface Window {
    desktop?: {
      platform: string;
      start: () => Promise<{ok:boolean; reason?:string}>;
      stop: () => Promise<{ok:boolean}>;
      pause: () => Promise<{ok:boolean}>;
      resume: () => Promise<{ok:boolean}>;
      move: (x:number,y:number) => void;
      click: () => void;
      wheel: (delta:number) => void;
      restore: () => Promise<{ok:boolean}>;
      onState: (callback:(state:{active:boolean;overlay:boolean;ready:boolean;pausedReason?:string|null})=>void) => () => void;
    };
  }
}
