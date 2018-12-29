export class Color {

    private value: number;

    constructor(value: number = 0) {
        this.value = value;
    }

    public getColor(): number {
        return this.value;
    }

    public static toArgbString(value: number): string {
        return "rgba(" + Color.red(value) + "," + Color.green(value) + "," + Color.blue(value) + "," + Color.alpha(value) / 255 + ")";
    }

    public static alpha(value: number): number {
        return ((value >> 24) & 0xff);
    }

    public static red(value: number): number {
        return ((value >> 16) & 0xff);
    }

    public static green(value: number): number {
        return ((value >> 8) & 0xff);
    }

    public static blue(value: number): number {
        return (value & 0xff);
    }

    public static make(r: number, g: number, b: number, a: number = 255): Color {
        return new Color(((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff));
    }

    public static makeGray(v: number): Color {
        return Color.make(v, v, v);
    }

    public static random(): Color {
        let r: number = Math.floor(Math.random() * 0xff);
        let g: number = Math.floor(Math.random() * 0xff);
        let b: number = Math.floor(Math.random() * 0xff);
        return Color.make(r, g, b);
    }

    public static randomGray(): Color {
        return Color.makeGray(Math.floor(Math.random() * 0xff));
    }
}