import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import connectDB from "./db";
import User from "@/models/User";
import { z } from "zod";
import { isRateLimited } from "./rateLimit";

/** Shown on the login page: too many attempts (see rateLimit). */
class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        // Against password guessing: 10 attempts per email and IP every 15 minutes.
        if (request?.headers && (await isRateLimited(request.headers, "login", 10, 900, email))) throw new TooManyAttempts();

        await connectDB();
        // The credentials provider backs the back-office portal only: customer accounts cannot sign in here.
        const user = await User.findOne({
          email: email.toLowerCase().trim(),
          isActive: true,
          role: { $exists: true, $nin: ["client", ""] },
        }).select("+password");

        if (!user) return null;

        const isValid = await user.comparePassword(password);
        if (!isValid) return null;

        // Update last login
        await User.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.avatar,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
});
