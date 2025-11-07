"use client"

import {
  X,
  User,
  SettingsIcon,
  Zap,
  CreditCard,
  Calendar,
  Phone,
  Mail,
  Hash,
  CheckCircle,
  Globe,
  Save,
  Volume2,
  MessageSquare,
  Database,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ConversationDetailsProps {
  isOpen: boolean
  activeTab: "actions" | "customer" | "settings"
  onTabChange: (tab: "actions" | "customer" | "settings") => void
  customerName: string
  onClose: () => void
}

export function ConversationDetails({
  isOpen,
  activeTab,
  onTabChange,
  customerName,
  onClose,
}: ConversationDetailsProps) {
  if (!isOpen) return null

  return (
    <div className="w-full md:w-[280px] border-l border-gray-200 h-full flex-shrink-0 bg-white/90 backdrop-blur-sm shadow-lg transition-all duration-300 fixed right-0 top-0 bottom-0 md:relative z-30 overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">Conversation details</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <X size={18} />
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as any)}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="actions" className="flex items-center gap-1">
            <Zap size={14} />
            <span>Actions</span>
          </TabsTrigger>
          <TabsTrigger value="customer" className="flex items-center gap-1">
            <User size={14} />
            <span>Customer</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1">
            <SettingsIcon size={14} />
            <span>Settings</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium text-sm">Quick actions</h3>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  <CreditCard size={14} className="mr-2" />
                  Check account status
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  <CreditCard size={14} className="mr-2" />
                  Process payment
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  <User size={14} className="mr-2" />
                  Update customer info
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  <Zap size={14} className="mr-2" />
                  Create support ticket
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium text-sm">Suggested responses</h3>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  I'll check your account right away.
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  Would you like to set up automatic payments?
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  Is there anything else I can help with today?
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="customer" className="p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium text-sm">Customer information</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center">
                  <User size={14} className="mr-2 text-gray-500" />
                  <span className="font-medium">Name:</span>
                  <span className="ml-2">{customerName}</span>
                </div>
                <div className="flex items-center">
                  <Mail size={14} className="mr-2 text-gray-500" />
                  <span className="font-medium">Email:</span>
                  <span className="ml-2">customer@example.com</span>
                </div>
                <div className="flex items-center">
                  <Phone size={14} className="mr-2 text-gray-500" />
                  <span className="font-medium">Phone:</span>
                  <span className="ml-2">(555) 123-4567</span>
                </div>
                <div className="flex items-center">
                  <Hash size={14} className="mr-2 text-gray-500" />
                  <span className="font-medium">Account:</span>
                  <span className="ml-2">#12345678</span>
                </div>
                <div className="flex items-center">
                  <CheckCircle size={14} className="mr-2 text-green-600" />
                  <span className="font-medium">Status:</span>
                  <span className="ml-2 text-green-600">Active</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium text-sm">Recent activity</h3>
              <div className="space-y-2 text-sm">
                <div className="p-2 border border-gray-200 rounded-md hover:border-blue-300 transition-colors">
                  <div className="flex items-center">
                    <CreditCard size={14} className="mr-2 text-blue-600" />
                    <p className="font-medium">Payment received</p>
                  </div>
                  <div className="flex items-center mt-1">
                    <Calendar size={14} className="mr-2 text-gray-500" />
                    <p className="text-gray-500 text-xs">July 15, 2024</p>
                  </div>
                </div>
                <div className="p-2 border border-gray-200 rounded-md hover:border-blue-300 transition-colors">
                  <div className="flex items-center">
                    <Zap size={14} className="mr-2 text-orange-600" />
                    <p className="font-medium">Support ticket #45678</p>
                  </div>
                  <div className="flex items-center mt-1">
                    <Calendar size={14} className="mr-2 text-gray-500" />
                    <p className="text-gray-500 text-xs">June 28, 2024</p>
                  </div>
                </div>
                <div className="p-2 border border-gray-200 rounded-md hover:border-blue-300 transition-colors">
                  <div className="flex items-center">
                    <User size={14} className="mr-2 text-purple-600" />
                    <p className="font-medium">Account updated</p>
                  </div>
                  <div className="flex items-center mt-1">
                    <Calendar size={14} className="mr-2 text-gray-500" />
                    <p className="text-gray-500 text-xs">June 10, 2024</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium text-sm">Chat settings</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center">
                    <Globe size={14} className="mr-2 text-gray-500" />
                    Auto-translate
                  </span>
                  <div className="relative inline-block w-10 h-5 rounded-full bg-gray-200">
                    <input type="checkbox" className="sr-only peer" id="auto-translate" />
                    <label
                      htmlFor="auto-translate"
                      className="absolute inset-0 rounded-full cursor-pointer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-5"
                    ></label>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center">
                    <Save size={14} className="mr-2 text-gray-500" />
                    Save chat history
                  </span>
                  <div className="relative inline-block w-10 h-5 rounded-full bg-gray-200">
                    <input type="checkbox" className="sr-only peer" id="save-history" defaultChecked />
                    <label
                      htmlFor="save-history"
                      className="absolute inset-0 rounded-full cursor-pointer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-5"
                    ></label>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center">
                    <Volume2 size={14} className="mr-2 text-gray-500" />
                    Enable voice
                  </span>
                  <div className="relative inline-block w-10 h-5 rounded-full bg-gray-200">
                    <input type="checkbox" className="sr-only peer" id="enable-voice" defaultChecked />
                    <label
                      htmlFor="enable-voice"
                      className="absolute inset-0 rounded-full cursor-pointer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-5"
                    ></label>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium text-sm">Agent settings</h3>
              <div className="space-y-2">
                <div>
                  <label className="text-sm block mb-1 flex items-center">
                    <MessageSquare size={14} className="mr-2 text-gray-500" />
                    Response style
                  </label>
                  <select className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option>Professional</option>
                    <option>Friendly</option>
                    <option>Concise</option>
                    <option>Detailed</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm block mb-1 flex items-center">
                    <Database size={14} className="mr-2 text-gray-500" />
                    Knowledge base
                  </label>
                  <select className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option>Customer Support</option>
                    <option>Technical Support</option>
                    <option>Billing</option>
                    <option>Sales</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

