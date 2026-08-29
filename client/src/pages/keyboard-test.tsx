import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useIOSKeyboard } from "@/hooks/use-ios-keyboard";
import { Capacitor } from '@capacitor/core';

export default function KeyboardTestPage() {
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  
  // Get iOS keyboard information
  const { 
    isNativeIOSApp, 
    keyboardHeight, 
    isKeyboardVisible, 
    hideKeyboard 
  } = useIOSKeyboard();

  const showKeyboard = async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.show();
    } catch (error) {
      console.warn('Unable to show keyboard:', error);
    }
  };

  const platform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="container max-w-md mx-auto p-4 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Keyboard Test</h1>
        <p className="text-muted-foreground text-sm">
          Test iOS native keyboard vs web keyboard
        </p>
      </div>

      {/* Platform Information */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between items-center">
            <span>Platform:</span>
            <Badge variant="outline">{platform}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span>Native App:</span>
            <Badge variant={isNative ? "default" : "secondary"}>
              {isNative ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span>iOS Native App:</span>
            <Badge variant={isNativeIOSApp ? "default" : "secondary"}>
              {isNativeIOSApp ? "Yes" : "No"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Keyboard Status */}
      <Card>
        <CardHeader>
          <CardTitle>Keyboard Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between items-center">
            <span>Keyboard Visible:</span>
            <Badge variant={isKeyboardVisible ? "default" : "secondary"}>
              {isKeyboardVisible ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span>Keyboard Height:</span>
            <Badge variant="outline">{keyboardHeight}px</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Test Inputs */}
      <Card>
        <CardHeader>
          <CardTitle>Test Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Input Field:</label>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type here to test keyboard..."
              className={isNativeIOSApp ? 'ios-native-input' : ''}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Textarea:</label>
            <Textarea
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
              placeholder="Type here to test keyboard..."
              rows={4}
              className={isNativeIOSApp ? 'ios-native-input' : ''}
            />
          </div>
        </CardContent>
      </Card>

      {/* Keyboard Controls (iOS Native Only) */}
      {isNativeIOSApp && (
        <Card>
          <CardHeader>
            <CardTitle>Keyboard Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button 
              onClick={showKeyboard} 
              variant="outline" 
              className="w-full"
            >
              Show Keyboard
            </Button>
            <Button 
              onClick={hideKeyboard} 
              variant="outline" 
              className="w-full"
            >
              Hide Keyboard
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Web Browser:</strong> Uses standard HTML5 keyboard with manual focus/blur detection.
          </p>
          <p>
            <strong>iOS Capacitor App:</strong> Uses native iOS keyboard with Capacitor Keyboard plugin for better integration.
          </p>
          <p>
            Tap on the input fields above to test keyboard behavior on your platform.
          </p>
        </CardContent>
      </Card>

      {/* Spacer for keyboard */}
      {isNativeIOSApp && isKeyboardVisible && (
        <div style={{ height: `${keyboardHeight}px` }} />
      )}
    </div>
  );
}