# Drawn 🏃🎨

**Drawn to run.** Design GPS art routes for your next run. Draw shapes, type text, or pick from presets and snap them to real streets using AI-powered spatial reasoning.

![Drawn Preview](https://picsum.photos/seed/running/1200/600)

## 🌟 Key Features

- **Multiple Generation Modes**:
  - **Shapes**: Choose from presets like Hearts, Stars, Circles, and more.
  - **Text**: Type any word and watch it transform into a runnable route.
  - **Draw**: Freehand draw your own masterpiece on the map.
- **AI-Powered Precision**: Uses **Gemini 3.1 Pro** to analyze real-world road networks and select the best "Anchor Points" to preserve your shape's integrity.
- **Smart Pre-Filtering**: Algorithmic corridor filtering ensures the AI only considers roads that actually fit your design, resulting in 90%+ shape fidelity.
- **Fitness Scoring**: Every route is graded on direction accuracy and distance consistency.
- **Real-Time Map Interaction**: Built with Leaflet for smooth, responsive map exploration.
- **Firebase Integration**: Save your favorite routes and access your profile across devices.

## 🚀 Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS 4.
- **AI/LLM**: Google Gemini 3.1 Pro via `@google/genai`.
- **Mapping & GIS**: 
  - **Leaflet**: Interactive map rendering.
  - **Overpass API**: Fetching real-world road network data.
  - **OSRM (Open Source Routing Machine)**: Precise pathfinding between AI-selected nodes.
  - **Turf.js**: Advanced geospatial calculations and buffering.
- **Backend/Auth**: Firebase (Authentication & Firestore).
- **Animations**: Motion (formerly Framer Motion).

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- A Google AI Studio API Key (for Gemini)
- An OpenRouteService API Key (for routing)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/drawn.git
   cd drawn
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the root directory and add your keys:
   ```env
   GEMINI_API_KEY=your_gemini_key_here
   VITE_OPENROUTESERVICE_API_KEY=your_ors_key_here
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🧠 How It Works

Drawn uses a unique hybrid approach to solve the complex problem of snapping abstract shapes to rigid road networks:

1.  **Ideal Path Generation**: The app calculates the mathematical "perfect" coordinates for your shape or text.
2.  **Corridor Filtering**: A dynamic buffer is created around the ideal path. We fetch only the roads within this corridor using the Overpass API.
3.  **AI Anchor Selection**: Gemini 3.1 Pro analyzes the filtered road network and selects "Anchor Points"—critical corners and curves that define the shape's skeleton.
4.  **Pathfinding**: OSRM calculates the actual runnable path between these anchors, following real streets and traffic rules.
5.  **Fitness Validation**: The final route is compared against the original design to ensure a high-quality match.

## 🤝 Contributing

Contributions are welcome! Whether it's adding new shape presets, improving the AI prompts, or fixing UI bugs:

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Built with ❤️ for the running community.*
