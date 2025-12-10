import { resetTestDb } from "./reset-test-db";

void resetTestDb({
  shouldReset: true,
  shouldSeed: true,
  seedType: "test",
})
  .then(() => console.log("Migration done"))
  .catch((error) => {
    console.error("Migration failed", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
