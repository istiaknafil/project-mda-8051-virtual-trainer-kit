import { mkdir, writeFile } from "node:fs/promises";
import { examples } from "../src/experiments/examples.ts";
await mkdir(new URL("../examples/", import.meta.url), { recursive: true });
for (const [name, source] of Object.entries(examples)) {
  const filename =
    name.split(" · ")[0].toLowerCase().replaceAll(" ", "-") + ".asm";
  await writeFile(
    new URL("../examples/" + filename, import.meta.url),
    source + "\n",
  );
}
