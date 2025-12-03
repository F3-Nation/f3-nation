function parseArgs() {
  const [, , currentSlackUserId, newSlackUserId] = process.argv;

  if (!currentSlackUserId || !newSlackUserId) {
    console.error(
      "Usage: pnpm migrate:user:posts <current-slack-user-id> <new-slack-user-id>",
    );
    process.exit(1);
  }

  return { currentSlackUserId, newSlackUserId };
}

async function main() {
  const { currentSlackUserId, newSlackUserId } = parseArgs();

  console.log(`Current Slack user ID: ${currentSlackUserId}`);
  console.log(`New Slack user ID: ${newSlackUserId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
