import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import readline from "node:readline";

loadEnvConfig(process.cwd(), false);

function ask(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => prompt.question(question, (answer) => {
    prompt.close();
    resolve(answer);
  }));
}

function askSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal so the password can be entered privately.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(question);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (key) => {
      if (key === "\u0003") {
        finish(new Error("Password reset cancelled."));
      } else if (key === "\r" || key === "\n") {
        finish();
      } else if (key === "\u007f" || key === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (key >= " " && key !== "\u007f") {
        value += key;
        process.stdout.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing. Pull the Vercel production environment first.");
  }

  const emailInput = await ask("Admin email [admin@paylesscarrental.com]: ");
  const email = (emailInput.trim() || "admin@paylesscarrental.com").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid admin email address.");
  }

  console.log(`This will reset the superadmin password for ${email} in database "${new URL(uri).pathname.slice(1).split("?")[0]}".`);
  const confirmation = await ask('Type RESET to continue: ');
  if (confirmation !== "RESET") {
    throw new Error("Password reset cancelled.");
  }

  const password = await askSecret("New password (minimum 12 characters): ");
  if (password.length < 12) {
    throw new Error("The new password must be at least 12 characters.");
  }
  const confirmationPassword = await askSecret("Confirm new password: ");
  if (password !== confirmationPassword) {
    throw new Error("The passwords do not match.");
  }

  await mongoose.connect(uri);
  const users = mongoose.connection.db.collection("users");
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const result = await users.updateOne(
    { email },
    {
      $set: { password: passwordHash, role: "superadmin", isActive: true, updatedAt: now },
      $setOnInsert: {
        email,
        name: "Admin Payless Tunisia",
        createdAt: now,
        preferences: { language: "fr", notifications: true },
      },
    },
    { upsert: true }
  );

  console.log(result.upsertedCount ? "Superadmin account created." : "Superadmin password reset successfully.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || "Admin password reset failed.");
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exitCode = 1;
});
