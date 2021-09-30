import * as Arrow from "../node_modules/apache-arrow/Arrow.dom";
import * as Arquero from "arquero";
import wasmModule from "../dist/gandiva.module";
import Benchmark from "benchmark";
import filter from "./filter";

async function main() {
    const warn = console.warn.bind(console);
    console.warn = () => { };
    const Gandiva = await wasmModule({
        locateFile: (file: string) => `base/dist/${file}`,
    });
    await filter(Benchmark, Arrow, Gandiva, Arquero);
    console.warn = warn;
}

(window as any).karmaCustomEnv = {
    execute: async (karma: any) => {
        await main();
        karma.result({ success: true, suite: [], log: [] });
        karma.complete({});
    }
};
