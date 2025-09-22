# ---------- Base image ----------
    FROM node:20-alpine

    # Timezone + production mode
    ENV TZ=Asia/Kolkata \
        NODE_ENV=production
    
    WORKDIR /app
    
    # ---------- Install dependencies ----------
    COPY package*.json ./
    RUN npm ci --omit=dev || npm install --only=production
    
    # ---------- Copy all source code ----------
    COPY . .
    
    # ---------- Built-in environment variables ----------
    ENV GOOGLE_CSE_KEY="AIzaSyBfXf4-hdiY5wXCVzmL63J8Tm3UScqTkYc" \
        GOOGLE_CX="12e23adc2c74f4acc" \
        DATE_RESTRICT="d7" \
        DAILY_QUERY_BUDGET="90" \
        MAX_PAGES_PER_ROLE="3" \
        OUT_CSV="/app/data/google_jobs.csv" \
        ROLES="Junior Java Developer, Junior Software Developer, Graduate Engineer Trainee, Software Trainee, QA Engineer, Frontend Engineer, Backend Engineer, Full Stack Engineer, Python Developer" \
        N8N_WEBHOOK_URL="https://auto.kodnest.com/webhook/job-upload"
    
    # ensure output dir exists
    RUN mkdir -p /app/data
    
    # ---------- Default command ----------
    CMD ["npm", "run", "both:deliver"]
    