// Helper to convert Bengali digits to English standard digits
function convertBengaliDigits(input: string): string {
  const bengaliToEnglishMap: { [key: string]: string } = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9"
  };
  return input.split("").map((char) => bengaliToEnglishMap[char] || char).join("");
}

export function processCommand(command: string): {
  action: string;
  url?: string;
  isBrowserAction: boolean;
} {
  const normalizedRaw = convertBengaliDigits(command);
  const lowerCmd = normalizedRaw.toLowerCase().trim();

  // 1. Media Search: Youtube
  const ytMatch = lowerCmd.match(/(?:play|youtube|গান|ভিডিও|ইউটিউব)\s+(.+?)(?:\s+on\s+youtube|\s+চালান|\s+বাজাও|\s+দেখাও)?$/i);
  if (ytMatch && (lowerCmd.includes("youtube") || lowerCmd.includes("play") || lowerCmd.includes("ইউটিউব") || lowerCmd.includes("গান") || lowerCmd.includes("বাজাও"))) {
    const query = encodeURIComponent(ytMatch[1].replace(/(on youtube|ইউটিউবে|চালান|বাজাও)/g, "").trim());
    return {
      action: `Playing "${ytMatch[1].trim()}" on YouTube! Enjoy the vibes, Sahid!`,
      url: `https://www.youtube.com/results?search_query=${query}`,
      isBrowserAction: true,
    };
  }

  // 2. Media Search: Spotify
  const spotifyMatch = lowerCmd.match(/(?:search|spotify|স্পটিফাই|মিউজিক)\s+(.+?)(?:\s+on\s+spotify|\s+এ\s+খোঁজো|\s+প্লে\s+করো)?$/i);
  if (spotifyMatch && (lowerCmd.includes("spotify") || lowerCmd.includes("স্পটিফাই") || lowerCmd.includes("মিউজিক"))) {
    const query = encodeURIComponent(spotifyMatch[1].replace(/(on spotify|স্পটিফাইতে|খোঁজো)/g, "").trim());
    return {
      action: `Searching or playing "${spotifyMatch[1].trim()}" on Spotify. Hope it's a sweet banger!`,
      url: `https://open.spotify.com/search/${query}`,
      isBrowserAction: true,
    };
  }

  // 3. WHATSAPP DETECTOR (Extremely Robust, English + Bengali)
  // Look for any whatsapp triggers
  const hasWhatsapp = lowerCmd.includes("whatsapp") || lowerCmd.includes("whats") || lowerCmd.includes("হোয়াটসঅ্যাপ") || lowerCmd.includes("ওয়াটসঅ্যাপ") || lowerCmd.includes("মেসেজ");
  if (hasWhatsapp) {
    // Extract any phone number sequence from the normalized command (digits, spaces, hyphens, plus)
    // Minimally 8 digits to qualify as a valid target phone number
    const phoneRegex = /(\+?[\d\s-]{8,15})/g;
    const phoneMatches = normalizedRaw.match(phoneRegex);
    
    if (phoneMatches && phoneMatches.length > 0) {
      // Find the match that contains actual digits and is long enough
      const rawPhone = phoneMatches.find(p => p.replace(/[^\d]/g, "").length >= 8);
      if (rawPhone) {
        const cleanPhone = rawPhone.replace(/[^\d+]/g, ""); // Keep plan plus and digits
        
        // Extract the message text by removing the phone number and common whatsapp commands
        let messageText = normalizedRaw
          .replace(rawPhone, "")
          .replace(/(send a whatsapp message to|send whatsapp to|whatsapp to|message|saying|whatsapp|whats|app|হোয়াটসঅ্যাপ|মেসেজ|পাঠাও|বলো|বোল|তোমাকে|নাম্বারে|কে|to|say)/gi, "")
          .replace(/\s+/g, " ")
          .trim();

        if (!messageText) {
          messageText = "Hello from Sahid Sheikh's Gimi AI!";
        }

        return {
          action: `Sure, Sahid! Launching WhatsApp Web to send: "${messageText}" to ${cleanPhone}.`,
          url: `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageText)}`,
          isBrowserAction: true,
        };
      }
    }
  }

  // 4. GOOGLE CALENDAR DETECTOR (Extremely Robust, English + Bengali)
  const hasCalendar = lowerCmd.includes("calendar") || lowerCmd.includes("meeting") || lowerCmd.includes("event") || lowerCmd.includes("ক্যালেন্ডার") || lowerCmd.includes("মিটিং") || lowerCmd.includes("ইভেন্ট");
  if (hasCalendar) {
    // Determine dynamic title / summary
    let summary = command
      .replace(/(set|add|create|a|meeting|calendar|event|on|at|with|ক্যালেন্ডার|মিটিং|সেট|করো|কর|একটি|ইভেন্ট)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    
    if (!summary) {
      summary = "Meeting with Sahid";
    }

    // GCal TEMPLATE render requires formatted dates: dates=YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ
    const startDt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now default
    const endDt = new Date(startDt.getTime() + 30 * 60 * 1000); // 30 minutes duration
    
    const toCalStr = (d: Date) => d.getUTCFullYear().toString() + 
      (d.getUTCMonth() + 1).toString().padStart(2, "0") + 
      d.getUTCDate().toString().padStart(2, "0") + "T" + 
      d.getUTCHours().toString().padStart(2, "0") + 
      d.getUTCMinutes().toString().padStart(2, "0") + 
      d.getUTCSeconds().toString().padStart(2, "0") + "Z";

    const startDtStr = toCalStr(startDt);
    const endDtStr = toCalStr(endDt);

    return {
      action: `Creating calendar event "${summary}" for you in Google Calendar! Opening renderer...`,
      url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(summary)}&dates=${startDtStr}/${endDtStr}&details=${encodeURIComponent("Scheduled via Gimi Voice Assistant")}`,
      isBrowserAction: true,
    };
  }

  // 5. General open command
  const openMatch = lowerCmd.match(/^(?:open|go\s+to|ওয়েবসাইট|ভিজিট|ব্রাউজ)\s+(.+)$/i);
  if (openMatch) {
    let website = openMatch[1].trim().replace(/\s+/g, "");
    if (!website.includes(".")) {
      website += ".com";
    }
    return {
      action: `Opening ${openMatch[1]} in your browser! Let's go!`,
      url: `https://www.${website}`,
      isBrowserAction: true,
    };
  }

  return { action: "", isBrowserAction: false };
}
