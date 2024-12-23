import chalk from "chalk";
import fs from "fs";
import ora from "ora";
import { wait } from "../utils/index.js";

export async function verifyCommand(
  jsonPath: string,
  address: string,
  name: string,
  testnet: boolean,
  args: any[] = []
): Promise<void> {
  console.log(
    chalk.blue(
      `🔧 Initializing verification on ${testnet ? "testnet" : "mainnet"}...`
    )
  );

  const baseUrl = testnet
    ? "https://sepolia.etherscan.io/"
    : "https://etherscan.io/";

  const response = await fetch(
    `${baseUrl}/api?module=verificationResults&action=getVerification&address=${address.toLowerCase()}`
  );

  const resData = await response.json();

  if (resData.data !== null) {
    console.log(
      chalk.green(
        `✅ Contract ${chalk.green(`${address}`)} is already verified.`
      )
    );
    return;
  }

  console.log(chalk.blue(`📄 Reading JSON Standard Input from ${jsonPath}...`));
  let parsedJson;

  try {
    const json = fs.readFileSync(jsonPath, "utf8");
    parsedJson = JSON.parse(json);
  } catch (error) {
    console.error(
      chalk.red("⚠️ Please check your JSON Standard Input file and try again.")
    );
    return;
  }

  console.log(
    `🔎 Verifying contract ${chalk.green(`${name}`)} deployed at ${chalk.green(
      `${address}`
    )}..`
  );

  const spinner = ora().start();

  try {
    if (
      !parsedJson.hasOwnProperty("solcLongVersion") ||
      !parsedJson.hasOwnProperty("input")
    ) {
      spinner.fail(
        "❌ Please check your JSON Standard Input file and try again."
      );
      return;
    }

    const solidityVersion = parsedJson.solcLongVersion;

    const { language, sources, settings } = parsedJson.input;

    const requestBody = {
      module: "contractVerifier",
      action: "verify",
      getDelayed: true,
      params: {
        request: {
          address: address.toLowerCase(),
          name,
          version: solidityVersion,
          language,
          sources,
          settings,
        },
      },
    };

    if (args.length > 0) {
      spinner.stop();
      console.log(
        chalk.blue(`📄 Using constructor arguments: ${args.join(", ")}`)
      );
      spinner.start();
      // @ts-ignore
      requestBody.params.request.constructorArguments = args;
    }

    const response = await fetch(`${baseUrl}/api`, {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      spinner.fail("❌ Error during contract verification.");
      return;
    }

    const resData = await response.json();
    const { _id } = resData.data;

    spinner.succeed("🎉 Contract verification request sent!");
    spinner.start("⏳ Waiting for verification confirmation...");

    const maxRetries = 10;
    const retryDelay = 4000;

    const match = await pollVerificationResult(
      baseUrl,
      _id,
      maxRetries,
      retryDelay
    );

    if (!match) {
      spinner.fail("❌ JSON Standard Input verification don't match.");
      return;
    }

    spinner.succeed("📜 Contract verified successfully!");

    const explorerUrl = testnet
      ? `https://sepolia.etherscan.io/address/${address}`
      : `https://etherscan.io/address/${address}`;

    console.log(
      chalk.white(`🔗 View on Explorer:`),
      chalk.dim(`${explorerUrl}`)
    );
  } catch (error) {
    spinner.fail("❌ Error during contract verification.");
    return;
  }
}

async function pollVerificationResult(
  baseUrl: string,
  verificationId: string,
  maxRetries: number,
  retryDelay: number
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const confirmation = await fetch(
      `${baseUrl}/api?module=contractVerifier&action=getVerificationResult&id=${verificationId}`
    );

    if (!confirmation.ok) {
      console.log(
        chalk.yellow("⚠️ Error fetching verification status, retrying...")
      );
    } else {
      const confirmationData = await confirmation.json();
      const { match } = confirmationData.data;

      if (match !== undefined) {
        return match;
      }
    }

    await wait(retryDelay);
  }

  console.log(
    chalk.red(
      "⚠️ Maximum retries reached, verification status could not be confirmed."
    )
  );
  return false;
}
