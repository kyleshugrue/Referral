// Top 10 companies by industry based on market cap, revenue, and industry leadership

export const industryCompanies = {
  "Technology": [
    "Apple",
    "Microsoft",
    "Alphabet (Google)",
    "Amazon",
    "Meta",
    "Tesla",
    "NVIDIA",
    "Oracle",
    "Salesforce",
    "Adobe"
  ],
  "Finance": [
    "JPMorgan Chase",
    "Bank of America",
    "Wells Fargo",
    "Goldman Sachs",
    "Morgan Stanley",
    "Citigroup",
    "American Express",
    "BlackRock",
    "Berkshire Hathaway",
    "Charles Schwab"
  ],
  "Accounting": [
    "Deloitte",
    "PwC (PricewaterhouseCoopers)",
    "EY (Ernst & Young)",
    "KPMG",
    "BDO Global",
    "Grant Thornton",
    "RSM International",
    "Crowe Global",
    "Baker Tilly",
    "Mazars"
  ],
  "Healthcare": [
    "Johnson & Johnson",
    "Pfizer",
    "UnitedHealth Group",
    "Roche",
    "Novartis",
    "AbbVie",
    "Merck & Co",
    "Bristol Myers Squibb",
    "AstraZeneca",
    "Eli Lilly"
  ],
  "Marketing": [
    "WPP",
    "Omnicom Group",
    "Publicis Groupe",
    "Interpublic Group",
    "Dentsu",
    "Havas",
    "Accenture Interactive",
    "Deloitte Digital",
    "IBM iX",
    "VMLY&R"
  ],
  "Sales": [
    "Salesforce",
    "HubSpot",
    "Oracle",
    "SAP",
    "Microsoft",
    "Adobe",
    "Zoom",
    "ServiceNow",
    "Workday",
    "Zendesk"
  ],
  "Engineering": [
    "Boeing",
    "Lockheed Martin",
    "General Electric",
    "Caterpillar",
    "3M",
    "Honeywell",
    "Siemens",
    "ABB",
    "Emerson Electric",
    "Raytheon Technologies"
  ],
  "Human Resources": [
    "Workday",
    "ADP",
    "Paychex",
    "Ultimate Software",
    "BambooHR",
    "Cornerstone OnDemand",
    "SuccessFactors (SAP)",
    "Oracle HCM Cloud",
    "Ceridian",
    "Paycom"
  ],
  "Operations": [
    "Amazon",
    "FedEx",
    "UPS",
    "DHL",
    "Walmart",
    "Target",
    "Home Depot",
    "Costco",
    "McDonald's",
    "Starbucks"
  ],
  "Legal": [
    "Baker McKenzie",
    "DLA Piper",
    "Latham & Watkins",
    "Clifford Chance",
    "Kirkland & Ellis",
    "Skadden, Arps",
    "White & Case",
    "Freshfields",
    "Allen & Overy",
    "Sullivan & Cromwell"
  ],
  "Design": [
    "IDEO",
    "Pentagram",
    "Frog Design",
    "Ammunition Group",
    "Method",
    "Fjord (Accenture)",
    "R/GA",
    "Huge",
    "Fantasy Interactive",
    "Work & Co"
  ]
};

// Helper function to get companies for a specific industry (case-insensitive)
export function getCompaniesByIndustry(industry: string): string[] {
  // Normalize input to Title Case to match our keys
  const normalizedIndustry = industry
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  return industryCompanies[normalizedIndustry as keyof typeof industryCompanies] || [];
}

// Helper function to get all industries
export function getAllIndustries(): string[] {
  return Object.keys(industryCompanies);
}

// Helper function to search companies across all industries
export function searchCompanies(query: string): { industry: string; companies: string[] }[] {
  const results: { industry: string; companies: string[] }[] = [];
  const searchTerm = query.toLowerCase();
  
  Object.entries(industryCompanies).forEach(([industry, companies]) => {
    const matchingCompanies = companies.filter(company => 
      company.toLowerCase().includes(searchTerm)
    );
    
    if (matchingCompanies.length > 0) {
      results.push({ industry, companies: matchingCompanies });
    }
  });
  
  return results;
}