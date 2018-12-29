import { Grid } from "./grid";

window.addEventListener("load", function () {

    let picker = document.getElementById("filepicker") as HTMLInputElement;

    if (!picker) {
        console.log("picker error");
        return;
    }

    let canvas = document.getElementById("canvas") as HTMLCanvasElement;

    if (!canvas) {
        return;
    }

    let ctx: CanvasRenderingContext2D = canvas.getContext("2d") as CanvasRenderingContext2D;
    if (!ctx) return;

    ctx.fillStyle = "rgba(255,255,255,1)"
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let grid: Grid = new Grid(canvas.width, canvas.height, 52);
    grid.setPadding(30);
    grid.setColor(0xff333333);
    grid.setStrokeWidth(0.5);
    // grid.draw(ctx);
    grid.drawWithoudRepeat(ctx);

    picker.addEventListener("change", function () {
        if (picker.files) {
            let fr: FileReader = new FileReader();
            fr.onload = (e1) => {
                let i = new Image();
                i.onload = () => {
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(i, 0, 0, canvas.width, canvas.height);
                    grid.drawWithoudRepeat(ctx);

                }
                i.src = fr.result as string;
            }
            fr.readAsDataURL(picker.files[0]);
        }
    });


}, false);



