import { refuseDirectSignIn } from "@/auth/route";
import { handlers } from "@/server/auth";

export const { GET, POST } = refuseDirectSignIn(handlers);
