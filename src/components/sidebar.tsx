"use client"

import { LayoutGrid, Zap, Link, Users, Settings, Eye, BarChart3, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  onToggleMobileMenu: () => void
}

export function Sidebar({ isOpen, onClose, onToggleMobileMenu }: SidebarProps) {
  const navItems = [
    { icon: <LayoutGrid size={18} />, label: "Tasks", active: true },
    { icon: <Zap size={18} />, label: "Functions" },
    { icon: <Link size={18} />, label: "Integrations" },
    { icon: <Users size={18} />, label: "Users" },
    { icon: <Settings size={18} />, label: "Settings" },
    { icon: <Eye size={18} />, label: "Live preview" },
    { icon: <BarChart3 size={18} />, label: "Performance" },
  ]

  return (
    <>
      {/* Mobile menu button - visible only on small screens */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleMobileMenu}
        className="md:hidden fixed top-2 left-2 z-50 bg-white/80 backdrop-blur-sm shadow-md rounded-full h-9 w-9"
      >
        {isOpen ? <X size={18} /> : <Menu size={18} />}
      </Button>

      <div
        className={`w-[192px] border-r border-gray-200 h-full flex-shrink-0 bg-white/90 backdrop-blur-sm shadow-lg transition-all duration-300 ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"} z-40 fixed md:relative`}
      >
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <h2 className="font-semibold text-lg">PromptHub Agent</h2>
          </div>
        </div>

        <nav className="py-4">
          <ul className="space-y-1">
            {navItems.map((item, index) => (
              <li key={index}>
                <a
                  href="#"
                  className={`flex items-center gap-3 px-4 py-2 hover:bg-gray-100 transition-colors ${item.active ? "text-blue-600 bg-blue-50" : "text-gray-700"}`}
                >
                  {item.icon}
                  <span className="text-sm">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Overlay for mobile */}
      {isOpen && <div className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-30" onClick={onClose}></div>}
    </>
  )
}

