"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {cn} from "@/lib/utils";
import {Badge} from "@/components/ui/badge";
import {
    Users,
    LayoutDashboard,
    MessageSquare,
    Settings,
    LayoutTemplate,
    Building2,
    FolderKanban,
    Cpu,
    BarChart3,
    DollarSign,
    FileStack,
    Cloud,
    Calculator,
    Activity,
    Sparkles,
    ScrollText,
} from "lucide-react";

const menuItems = [
    {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
    },
    {
        title: "Estadísticas",
        href: "/dashboard/analytics",
        icon: BarChart3,
    },
    {
        title: "Conversaciones",
        href: "/dashboard/conversations",
        icon: MessageSquare,
    },
    {
        title: "Generaciones",
        href: "/dashboard/generations",
        icon: FileStack,
    },
    {
        title: "Proyectos",
        href: "/dashboard/projects",
        icon: FolderKanban,
    },
    {
        title: "Clientes",
        href: "/dashboard/clients",
        icon: Building2,
    },
    {
        title: "Usuarios",
        href: "/dashboard/users",
        icon: Users,
    },
    {
        title: "Modelos",
        href: "/dashboard/models",
        icon: Cpu,
    },
    {
        title: "Templates",
        href: "/dashboard/templates",
        icon: LayoutTemplate,
    },
    {
        title: "Calculadora IA",
        href: "/dashboard/calculadora",
        icon: Calculator,
    },
    {
        title: "Workers",
        href: "/dashboard/workers",
        icon: Activity,
    },
    {
        title: "Docker Logs",
        href: "/dashboard/logs",
        icon: ScrollText,
    },
    {
        title: "Changelog",
        href: "/dashboard/changelog",
        icon: Sparkles,
    },
    {
        title: "Chat",
        href: "/",
        icon: MessageSquare,
    },
    {
        title: "Costos GCP",
        href: "/dashboard/billing",
        icon: Cloud,
    },
    {
        title: 'Facturación GCP',
        href: "https://console.cloud.google.com/billing/011AA4-02B727-A9BC2E/reports;credits=NONE?invt=AcGE5w&organizationId=282755889495&project=puerto-ia",
        icon: DollarSign,
        target: "_blank"
    }

];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="w-60 border-r border-border/50 bg-sidebar min-h-[calc(100vh-3.5rem)] flex flex-col">
            <nav className="p-3 space-y-1 flex-1">
                {menuItems.map((item) => {
                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && item.href !== "/" && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            target={item.target??'_self'}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}
                        >
                            <item.icon className={cn("h-5 w-5", isActive && "text-primary")}/>
                            {item.title}
                        </Link>
                    );
                })}
            </nav>
            <div className="p-3 flex justify-center">
                <Badge className="text-[10px]">
                    v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
                </Badge>
            </div>
        </aside>
    );
}
