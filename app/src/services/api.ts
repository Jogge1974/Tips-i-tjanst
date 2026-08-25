// API Base URL - Azure Function App
export const API_BASE_URL = 'https://tipsitjanst-api.azurewebsites.net/api/api';
// Gammal (utgangen subscription): 'https://tipstjanst-api-bpdxhah7f9hxhpce.westeurope-01.azurewebsites.net/api/api'
// Lokal test: 'http://localhost:7071/api/api'
// Gammal PHP: 'http://malte.liveidrott.se.linux225.unoeuro-server.com/api/api.php'

export interface User {
  id: number;
  fornamn: string;
  efternamn: string;
  userType?: string;
}

export interface LoginResponse {
  success: boolean;
  user?: User;
  error?: string;
}

export interface GameStatus {
  speletOppet: number; // 0=stängt, 1=tipstecken, 2=garderingar
  isSlutspel: number;
  spelomgang: string;
  antalRatt: number;
}

export interface MatchInfo {
  matchNr: string;
  lag: string;
  home: string;
  away: string;
  liga: string;
  spelomgang: string;
  etta: string;
  kryss: string;
  tvaa: string;
  odds1?: string;
  oddsX?: string;
  odds2?: string;
}

export interface Gardering {
  matchNr: number;
  tecken: string;
}

export interface SlutspelEntry {
  id: number | null;
  namn: string;
  resultat: number | null;
  sortpoang: number | null;
  advances: boolean;
  poang?: number;
}

export interface SlutspelPhase {
  played: boolean;
  entries: SlutspelEntry[];
}

export interface SlutspelData {
  sasong: number | null;
  currentPhase?: 'kvart' | 'semi' | 'final' | 'done';
  kvart?: SlutspelPhase;
  semi?: SlutspelPhase;
  final?: SlutspelPhase;
  winner?: { id: number | null; namn: string } | null;
}

export const api = {
  async getUsers(): Promise<User[]> {
    const response = await fetch(`${API_BASE_URL}?action=getUsers`);
    if (!response.ok) throw new Error('Kunde inte hämta användare');
    return response.json();
  },

  async login(userId: number, password: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE_URL}?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    if (!response.ok) throw new Error('Inloggning misslyckades');
    return response.json();
  },

  async getStatus(): Promise<GameStatus> {
    const response = await fetch(`${API_BASE_URL}?action=getStatus`);
    if (!response.ok) throw new Error('Kunde inte hämta spelstatus');
    return response.json();
  },

  async getMyMatch(userId: number): Promise<MatchInfo | null> {
    const response = await fetch(`${API_BASE_URL}?action=getMyMatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) throw new Error('Kunde inte hämta din match');
    return response.json();
  },

  async getKupong(): Promise<MatchInfo[]> {
    const response = await fetch(`${API_BASE_URL}?action=getKupong`);
    if (!response.ok) throw new Error('Kunde inte hämta kupong');
    return response.json();
  },

  async saveTips(userId: number, tecken: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${API_BASE_URL}?action=saveTips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, tecken }),
    });
    if (!response.ok) throw new Error('Kunde inte spara tips');
    return response.json();
  },

  async getGarderingar(userId: number): Promise<Gardering[]> {
    const response = await fetch(`${API_BASE_URL}?action=getGarderingar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) throw new Error('Kunde inte hämta garderingar');
    return response.json();
  },

  async saveGarderingar(userId: number, garderingar: Gardering[]): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${API_BASE_URL}?action=saveGarderingar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, garderingar }),
    });
    if (!response.ok) throw new Error('Kunde inte spara garderingar');
    return response.json();
  },

  async getLiveDraw(): Promise<any> {
    const response = await fetch(`${API_BASE_URL}?action=getLiveDraw`);
    if (!response.ok) throw new Error('Kunde inte hämta live-data');
    return response.json();
  },

  async getLiveResult(drawNumber?: number): Promise<any> {
    const url = drawNumber
      ? `${API_BASE_URL}?action=getLiveResult&drawNumber=${drawNumber}`
      : `${API_BASE_URL}?action=getLiveResult`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Kunde inte hämta resultat');
    return response.json();
  },

  async getSystemRows(drawNumber: number): Promise<any[]> {
    const response = await fetch(`${API_BASE_URL}?action=getSystemRows&drawNumber=${drawNumber}`);
    if (!response.ok) throw new Error('Kunde inte hämta systemrader');
    return response.json();
  },

  async getTipsAllsvenskan(userId?: number): Promise<{ standings: any[]; myPosition: number | null; sasong: number | null }> {
    const url = userId
      ? `${API_BASE_URL}?action=getTipsAllsvenskan&userId=${userId}`
      : `${API_BASE_URL}?action=getTipsAllsvenskan`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Kunde inte hämta TipsAllsvenskan');
    return response.json();
  },

  async getDashboard(userId: number): Promise<any> {
    const response = await fetch(`${API_BASE_URL}?action=getDashboard&userId=${userId}`);
    if (!response.ok) throw new Error('Kunde inte hämta dashboard');
    return response.json();
  },

  async getSlutspel(): Promise<SlutspelData> {
    const response = await fetch(`${API_BASE_URL}?action=getSlutspel`);
    if (!response.ok) throw new Error('Kunde inte hämta slutspel');
    return response.json();
  },

  async getLiveGarderingTable(): Promise<{ isSlutspel: number; table: { userId: number; namn: string; ratt: number | null; position: number | null }[] }> {
    const response = await fetch(`${API_BASE_URL}?action=getLiveGarderingTable`);
    if (!response.ok) throw new Error('Kunde inte hämta garderingstabell');
    return response.json();
  },

  async getMallista(): Promise<{ eventNumber: number; home: string; away: string; fromScore: string; toScore: string; detectedAtMs: number }[]> {
    const response = await fetch(`${API_BASE_URL}?action=getMallista`);
    if (!response.ok) throw new Error('Kunde inte hämta målrapport');
    return response.json();
  },

  async getGrundtipsen(): Promise<{ matchNr: number; ansvarig: string; tecken: string | null; isCorrect: boolean | null; isSTMF: boolean; odds: number; score: string | null; status: string; isFinished: boolean; cancelled: boolean; sportEventStart: string }[]> {
    const response = await fetch(`${API_BASE_URL}?action=getGrundtipsen`);
    if (!response.ok) throw new Error('Kunde inte hämta grundtipsen');
    return response.json();
  },

  async getRoundHistory(): Promise<{
    sasong: number | null;
    rounds: {
      roundNr: number;
      spelomgang: string;
      isSlutspel: number;
      grundtips: { matchNr: number; ansvarig: string; tecken: string | null; rtecken: string | null; isCorrect: boolean | null; isSTMF: boolean; odds: number }[];
      garderingTable: { userId: number; namn: string; ratt: number | null; position: number | null }[];
    }[];
  }> {
    const response = await fetch(`${API_BASE_URL}?action=getRoundHistory`);
    if (!response.ok) throw new Error('Kunde inte hämta omgångshistorik');
    return response.json();
  },

  async getUserKupong(userId: number, spelomgang: string): Promise<{
    userName: string;
    spelomgang: string;
    isSlutspel: number;
    matches: {
      matchNr: number;
      lag: string;
      grundtecken: string | null;
      userTecken: string | null;
      rtecken: string | null;
      isCorrect: boolean | null;
      isSTMF: boolean;
      odds: number;
    }[];
  }> {
    const response = await fetch(`${API_BASE_URL}?action=getUserKupong&userId=${userId}&spelomgang=${encodeURIComponent(spelomgang)}`);
    if (!response.ok) throw new Error('Kunde inte hämta kupong');
    return response.json();
  },

  async getAllGarderingar(spelomgang: string): Promise<{
    spelomgang: string;
    isSlutspel: number;
    matches: { matchNr: number; lag: string; rtecken: string | null }[];
    users: { userId: number; namn: string; ratt: number; tecken: Record<string, { t: string | null; c: boolean | null }> }[];
  }> {
    const response = await fetch(`${API_BASE_URL}?action=getAllGarderingar&spelomgang=${encodeURIComponent(spelomgang)}`);
    if (!response.ok) throw new Error('Kunde inte hämta garderingar');
    return response.json();
  },

  async avslutaOmgang(): Promise<{
    success: boolean;
    spelomgang: string;
    antalRatt: number;
    insats: number;
    vinst: number;
    tipsAllsvenskanUpdated: boolean;
    slutspelUpdated?: boolean;
  }> {
    const response = await fetch(`${API_BASE_URL}?action=avslutaOmgang`);
    if (!response.ok) throw new Error('Kunde inte avsluta omgång');
    return response.json();
  },

  async analyzeMatch(hemmalag: string, bortalag: string, serie?: string, matchdata?: string): Promise<{ analysis?: string; error?: string; message?: string }> {
    const response = await fetch(`${API_BASE_URL}?action=analyzeMatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hemmalag, bortalag, serie: serie || '', matchdata: matchdata || '' }),
    });
    if (response.status === 429) {
      return { error: 'rate_limit', message: 'För många förfrågningar. Försök igen om 1 minut.' };
    }
    if (!response.ok) throw new Error('Kunde inte hämta analys');
    return response.json();
  },
};
