"use client";

import { signOut, useSession } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, User, ChevronDown } from "lucide-react";

export function Header() {
  const { data: session } = useSession();

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="h-14 border-b border-border/50 bg-[#131318] flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-sm">
            NS
          </div>
          <span className="text-lg font-semibold tracking-tight">
            NANANO <span className="text-yellow-400">STUDIO</span>
          </span>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 outline-none hover:bg-accent/50 rounded-lg px-2 py-1.5 transition-colors">
          <Avatar className="h-7 w-7">
            <AvatarImage src={session?.user?.image || undefined} />
            <AvatarFallback className="bg-primary/20 text-primary text-xs">
              {getInitials(session?.user?.name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-muted-foreground hidden sm:block">
            {session?.user?.name}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span>{session?.user?.name}</span>
              <span className="text-xs text-muted-foreground font-normal">
                {session?.user?.email}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-red-400 cursor-pointer focus:text-red-400"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
