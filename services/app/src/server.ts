import { buildApp } from "./app.js";

const configName = process.env.APP_ENV === "production" ? "production" : "development";

const app = await buildApp(configName);

const server = app.listen(5000, "0.0.0.0");
server.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
