pipeline {
    agent any

    environment {
        PROJECT_ID = "bitirme-pubsub"
        REGION = "europe-west1"
        REPOSITORY = "examflow-images"
        IMAGE_API = "examflow-api"
        IMAGE_WORKER = "examflow-worker"
        CLUSTER_NAME = "examflow-cluster"
    }

    stages {
        stage('Verify Tools') {
            steps {
                sh 'docker --version'
                sh 'gcloud --version'
                sh 'kubectl version --client'
            }
        }

        stage('GCP Auth & Cluster Access') {
            steps {
                sh '''
                gcloud config set project $PROJECT_ID
                gcloud auth configure-docker $REGION-docker.pkg.dev -q
                gcloud container clusters get-credentials $CLUSTER_NAME --region=$REGION
                '''
            }
        }

        stage('Build API Image') {
            steps {
                dir('services/api-service') {
                    sh 'docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_API:latest .'
                }
            }
        }

        stage('Build Worker Image') {
            steps {
                dir('services/worker-service') {
                    sh 'docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_WORKER:latest .'
                }
            }
        }

        stage('Push Images') {
            steps {
                sh '''
                docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_API:latest
                docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_WORKER:latest
                '''
            }
        }

        stage('Deploy to GKE') {
            steps {
                sh 'kubectl apply -f k8s/'
            }
        }
    }
}