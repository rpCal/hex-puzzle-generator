import { Color } from "./color";

export class Grid {

    private width: number;
    private height: number;
    private radius: number;
    private color: number;
    private strokeWidth: number = 1;
    private padding: number = 0;

    constructor(w: number, h: number, r: number = 50, c: number = 0x44333333) {
        this.width = w;
        this.height = h;
        this.radius = r;
        this.color = c;
    }

    public draw(canvas: CanvasRenderingContext2D): void {

        canvas.save();
        canvas.strokeStyle = Color.toArgbString(this.color);
        canvas.lineWidth = this.strokeWidth;
        canvas.imageSmoothingEnabled = false;

        let h: number = (this.radius * Math.sqrt(3)) / 2;
        let r: number = this.radius;

        let hs = h * 2
        let vs = r * 1.5;

        let sw: number = Math.floor((this.width - (this.padding * 2)) / hs);
        let sh: number = Math.floor((this.height - (this.padding * 2)) / vs);

        let px = (this.width - (hs * sw)) / 2;
        let py = (this.height - (vs * sh)) / 2;

        console.log("Grids:" + (sw * sh - ((sh - 1) / 2)));

        for (let j = 0; j < sh; j++) {

            let swx = sw;
            let off = 0;
            if (j % 2 == 1) {
                off += h;
                swx = sw - 1;
            }

            for (let i = 0; i < swx; i++) {

                let cx: number = px + hs / 2 + i * hs + off;
                let cy: number = py + vs / 2 + j * vs;

                canvas.beginPath();

                for (let a = 0; a < 6; a++) {

                    let angle: number = this.radians(a * 60 + 90);
                    let x: number = (cx + Math.cos(angle) * r);
                    let y: number = (cy + Math.sin(angle) * r);
                    if (a == 0) {
                        canvas.moveTo(x, y);
                    } else {
                        canvas.lineTo(x, y);
                    }
                }
                canvas.closePath();
                canvas.stroke();
            }
        }
        canvas.restore();
    }

    public drawWithoudRepeat(canvas: CanvasRenderingContext2D): void {

        canvas.save();
        canvas.strokeStyle = Color.toArgbString(this.color);
        canvas.lineWidth = this.strokeWidth;
        canvas.imageSmoothingEnabled = false;

        let h: number = (this.radius * Math.sqrt(3)) / 2;
        let r: number = this.radius;

        let hs = h * 2
        let vs = r * 1.5;

        let sw: number = Math.floor((this.width - (this.padding * 2)) / hs);
        let sh: number = Math.floor((this.height - (this.padding * 2)) / vs);

        let px = (this.width - (hs * sw)) / 2;
        let py = (this.height - (vs * sh)) / 2;

        console.log("Grids:" + (sw * sh - ((sh - 1) / 2)));

        for (let j = 0; j < sh + 1; j++) {

            let d = 1;
            let swx = sw;
            if (j % 2 == 1) {
                swx = sw;
                d = -1;
            }
            let lx = 0;
            let ly = 0;

            for (let i = 0; i < swx * 2 + 1; i++) {

                let cx: number = px + i * hs / 2;
                let cy: number = py + vs / 2 + j * vs;

                let x: number = cx;
                let y: number = cy - r / 2 + (j % 2 == 1 ? (i % 2 == 1 ? 0 : d * r / 2) : (i % 2 == 0 ? 0 : d * -r / 2));

                if (i != 0) {
                    if (j == sh && (i == 1 || i == swx * 2) && j % 2 == 0) {
                        // special case :)
                    } else {
                        canvas.beginPath();
                        canvas.moveTo(lx, ly);
                        canvas.lineTo(x, y);
                        canvas.stroke();
                    }
                }

                if (i % 2 == 0) {
                    if (j != sh) {
                        if (j % 2 == 0) {
                            canvas.beginPath();
                            canvas.moveTo(x, y);
                            canvas.lineTo(x, y + r);
                            canvas.stroke();
                        } else if(i != swx*2){
                            canvas.beginPath();
                            canvas.moveTo(x + hs / 2, y + r / 2);
                            canvas.lineTo(x + hs / 2, y + r + r / 2);
                            canvas.stroke();
                        }
                    }
                }
                lx = x;
                ly = y;
            }
        }
        canvas.restore();
    }

    public setPadding(padding: number): void {
        this.padding = padding;
    }

    public setColor(color: number): void {
        this.color = color;
    }

    public setStrokeWidth(width: number): void {
        this.strokeWidth = width;
    }


    private radians(degrees: number): number {
        return degrees * Math.PI / 180;
    }

}