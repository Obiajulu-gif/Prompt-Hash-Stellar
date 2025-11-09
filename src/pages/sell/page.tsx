"use client";

import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreatePromptForm } from "./CreatePromptForm";
import MyPrompts from "./MyPrompts";


export default function SellPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-r from-purple-400 to-blue-500">
      <Navigation />
      <main className="flex-1 container py-8">
        <div className="max-w-5xl mx-auto">
          <Tabs defaultValue="new">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">New Prompt</TabsTrigger>
              <TabsTrigger value="listings">My Prompts</TabsTrigger>
            </TabsList>

            <TabsContent value="new" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Create a New Prompt</CardTitle>
                </CardHeader>
                <CardContent>
                  <CreatePromptForm />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="listings" className="mt-6">
              <MyPrompts />
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />
    </div>
  );
}
