// Khai báo tối thiểu cho các module node:* mà vite.config.ts dùng.
// Repo không kéo @types/node (không thêm dependency); shim này chỉ phủ đúng API cần thiết.

declare module "node:child_process" {
  interface ExecFileSyncOptions {
    cwd?: string;
    encoding?: string;
    stdio?: string;
  }
  export function execFileSync(file: string, args?: readonly string[], options?: ExecFileSyncOptions): string;
}

declare module "node:fs" {
  export function readFileSync(path: string, options?: string | { encoding?: string }): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
