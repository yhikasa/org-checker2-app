CREATE TABLE login_check_summary (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    password TEXT NOT NULL
);

CREATE TABLE login_check_detail (
    detail_id SERIAL PRIMARY KEY,
    run_id UUID REFERENCES login_check_summary(run_id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILURE, ERROR
    result_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);