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
    TrendingUp,
    Wallet,
} from "lucide-react";

type MenuItem = {
    title: string;
    href: string;
    icon: typeof Users;
    target?: string;
    children?: MenuItem[];
};

const menuItems: MenuItem[] = [
    {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
    },
    {
        title: "Estadísticas",
        href: "/dashboard/analytics",
        icon: BarChart3,
        children: [
            {
                title: "Semanal por Cliente",
                href: "/dashboard/analytics/weekly",
                icon: TrendingUp,
            },
        ],
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
        title: "Ajustes Financieros",
        href: "/dashboard/settings/finance",
        icon: Wallet,
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

function isItemActive(item: MenuItem, pathname: string): boolean {
    if (pathname === item.href) return true;
    if (item.href === "/dashboard" || item.href === "/") return false;
    // Active si estamos en esta ruta exacta o en una sub-ruta que NO pertenezca a un child
    if (pathname.startsWith(item.href)) {
        if (item.children) {
            for (const child of item.children) {
                if (pathname === child.href || pathname.startsWith(child.href + "/")) {
                    return false; // deja que el child tome el estado activo
                }
            }
        }
        return true;
    }
    return false;
}

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="w-60 border-r border-border/50 bg-sidebar min-h-[calc(100vh-3.5rem)] flex flex-col">
            <nav className="p-3 space-y-1 flex-1">
                {menuItems.map((item) => {
                    const isActive = isItemActive(item, pathname);

                    return (
                        <div key={item.href}>
                            <Link
                                href={item.href}
                                target={item.target ?? '_self'}
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

                            {item.children && item.children.map((child) => {
                                const childActive =
                                    pathname === child.href || pathname.startsWith(child.href + "/");
                                return (
                                    <Link
                                        key={child.href}
                                        href={child.href}
                                        className={cn(
                                            "flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm transition-all ml-3 border-l border-border/50",
                                            childActive
                                                ? "text-primary font-medium"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <child.icon className={cn("h-4 w-4", childActive && "text-primary")}/>
                                        {child.title}
                                    </Link>
                                );
                            })}
                        </div>
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
