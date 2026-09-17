declare const __BUILD_ID__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
export const BUILD_TIME: string = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
