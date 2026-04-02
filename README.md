# CSV Analyst

Ask questions about any CSV file in plain English. Built with LangChain, Ollama, and Flask.

## Tech Stack
- **LangChain** — pandas dataframe agent
- **Ollama** — local LLM (llama3.1 / mistral / qwen2.5)
- **Flask** — backend API
- **HTML/CSS/JS** — frontend

## Setup

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Pull a model**
```bash
ollama pull llama3.1
```

**3. Update model name in `app.py` if needed**
```python
model="llama3.1"
```

**4. Run**
```bash
python app.py
```

**5. Open browser**
```
http://localhost:5000
```

## Features
- Upload any CSV — drag and drop supported
- Auto-detects column types and null values
- Generates charts for visual queries
- Smart question suggestions based on your data