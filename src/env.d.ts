/// <reference types="tampermonkey" />

declare module "html2canvas" {
  export default function html2canvas(
    element: HTMLElement,
    options?: Record<string, unknown>,
  ): Promise<HTMLCanvasElement>;
}
