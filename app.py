from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pandas as pd
import os
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from langchain_ollama import ChatOllama
from langchain_experimental.agents import create_pandas_dataframe_agent

app = Flask(__name__, static_folder=".")
CORS(app)

df = None
agent = None

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def build_agent(dataframe):
    col_info = "\n".join([f"- {col}: {str(dataframe[col].dtype)}" for col in dataframe.columns])
    prefix = f"""You are a data analyst. The DataFrame has these columns:
{col_info}

Shape: {dataframe.shape[0]} rows x {dataframe.shape[1]} columns

Rules:
- Answer clearly in plain English
- Round numbers to 2 decimal places
- Never modify the original DataFrame
"""

    llm = ChatOllama(
        model="llama3.1",   # change to your model: ollama list
        temperature=0,
    )

    return create_pandas_dataframe_agent(
        llm,
        dataframe,
        prefix=prefix,
        verbose=True,
        agent_type="zero-shot-react-description",
        allow_dangerous_code=True,
    )


def try_generate_chart(dataframe, query):
    try:
        fig, ax = plt.subplots(figsize=(8, 4))
        numeric_cols = dataframe.select_dtypes(include='number').columns.tolist()
        categorical_cols = dataframe.select_dtypes(include=['object', 'category']).columns.tolist()
        q = query.lower()

        if any(w in q for w in ['bar', 'count', 'category', 'group']):
            if categorical_cols and numeric_cols:
                grouped = dataframe.groupby(categorical_cols[0])[numeric_cols[0]].mean().sort_values(ascending=False).head(10)
                grouped.plot(kind='bar', ax=ax, color='#2563eb', edgecolor='white')
                ax.set_title(f"Avg {numeric_cols[0]} by {categorical_cols[0]}")
                plt.xticks(rotation=35, ha='right')
        elif any(w in q for w in ['trend', 'over time', 'line', 'monthly']):
            date_cols = [c for c in dataframe.columns if 'date' in c.lower() or 'time' in c.lower()]
            if date_cols and numeric_cols:
                temp = dataframe[[date_cols[0], numeric_cols[0]]].copy()
                temp[date_cols[0]] = pd.to_datetime(temp[date_cols[0]], errors='coerce')
                temp.dropna().sort_values(date_cols[0]).plot(x=date_cols[0], y=numeric_cols[0], ax=ax, color='#2563eb')
                ax.set_title(f"{numeric_cols[0]} over time")
        elif any(w in q for w in ['scatter', 'correlat', 'relationship']):
            if len(numeric_cols) >= 2:
                ax.scatter(dataframe[numeric_cols[0]], dataframe[numeric_cols[1]], alpha=0.5, color='#2563eb')
                ax.set_xlabel(numeric_cols[0])
                ax.set_ylabel(numeric_cols[1])
                ax.set_title(f"{numeric_cols[0]} vs {numeric_cols[1]}")
        elif any(w in q for w in ['histogram', 'distribution', 'spread']):
            if numeric_cols:
                dataframe[numeric_cols[0]].hist(bins=20, ax=ax, color='#2563eb', edgecolor='white')
                ax.set_title(f"Distribution of {numeric_cols[0]}")
        else:
            plt.close(fig)
            return None

        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        plt.tight_layout()

        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=120, bbox_inches='tight')
        buf.seek(0)
        result = base64.b64encode(buf.read()).decode('utf-8')
        plt.close(fig)
        return result
    except Exception:
        plt.close('all')
        return None


@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(".", filename)


@app.route("/upload", methods=["POST"])
def upload():
    global df, agent

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported"}), 400

    path = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(path)

    try:
        # try common encodings in order
        for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
            try:
                df = pd.read_csv(path, encoding=encoding)
                break
            except UnicodeDecodeError:
                continue
        agent = build_agent(df)

        info = {
            "filename": file.filename,
            "rows": int(df.shape[0]),
            "cols": int(df.shape[1]),
            "columns": [
                {
                    "name": col,
                    "type": str(df[col].dtype),
                    "nulls": int(df[col].isnull().sum()),
                }
                for col in df.columns
            ],
        }
        return jsonify({"success": True, "info": info})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/ask", methods=["POST"])
def ask():
    global df, agent

    if df is None or agent is None:
        return jsonify({"error": "No CSV loaded. Please upload a file first."}), 400

    query = request.json.get("query", "").strip()
    if not query:
        return jsonify({"error": "Empty query"}), 400

    try:
        result = agent.invoke(query)
        answer = result.get("output", "No response generated.")

        chart = None
        chart_keywords = ['bar', 'chart', 'plot', 'graph', 'visualize', 'trend',
                          'distribution', 'scatter', 'histogram', 'over time', 'correlat']
        if any(w in query.lower() for w in chart_keywords):
            chart = try_generate_chart(df, query)

        return jsonify({"answer": answer, "chart": chart})
    except Exception as e:
        return jsonify({"error": f"Agent error: {str(e)}"}), 500


@app.route("/reset", methods=["POST"])
def reset():
    global df, agent
    df = None
    agent = None
    return jsonify({"success": True})


@app.route("/suggestions", methods=["GET"])
def suggestions():
    global df
    if df is None:
        return jsonify({"questions": []})

    numeric_cols = df.select_dtypes(include='number').columns.tolist()
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()

    questions = [
        "How many rows and columns does this dataset have?",
        "Are there any missing values?",
        "Show me the first 5 rows",
    ]
    if numeric_cols:
        questions.append(f"What is the average {numeric_cols[0]}?")
        questions.append(f"Show the distribution of {numeric_cols[0]}")
    if categorical_cols:
        questions.append(f"What are the unique values in {categorical_cols[0]}?")
    if numeric_cols and categorical_cols:
        questions.append(f"Bar chart of {numeric_cols[0]} by {categorical_cols[0]}")

    return jsonify({"questions": questions})


if __name__ == "__main__":
    app.run(debug=True, port=5000)