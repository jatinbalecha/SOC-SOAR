@echo off
title SOC Streamlit UI - keep this window open
"%SOC_PYTHON%" -m streamlit run app.py --server.address 127.0.0.1 --server.port 8501 --server.headless true --browser.gatherUsageStats false
pause
