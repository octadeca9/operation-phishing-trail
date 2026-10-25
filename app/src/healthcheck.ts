// Health check executable untuk Docker HEALTHCHECK.
// Exit 0 jika /healthz OK, selain itu exit 1.
import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);

const req = http.get({ host: "127.0.0.1", port, path: "/healthz", timeout: 3000 }, (res) => {
  if (res.statusCode === 200) {
    res.resume();
    res.on("end", () => process.exit(0));
  } else {
    process.exit(1);
  }
});
req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
