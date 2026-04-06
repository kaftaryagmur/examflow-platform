pipeline {
    agent any

    environment {
        PROJECT_ID   = "bitirme-pubsub"
        REGION       = "europe-west1"
        REPOSITORY   = "examflow-images"
        IMAGE_API    = "examflow-api"
        IMAGE_WORKER = "examflow-worker"
        CLUSTER_NAME = "examflow-cluster"
        NAMESPACE    = "examflow"

        API_IMAGE_FULL    = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_API}"
        WORKER_IMAGE_FULL = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_WORKER}"
        IMAGE_TAG         = "${BUILD_NUMBER}"
        GO_TEST_IMAGE     = "golang:1.26.1"
    }

    stages {
        stage('Show Context') {
            steps {
                echo "BRANCH_NAME=${env.BRANCH_NAME}"
                echo "CHANGE_ID=${env.CHANGE_ID}"
                echo "CHANGE_BRANCH=${env.CHANGE_BRANCH}"
                echo "CHANGE_TARGET=${env.CHANGE_TARGET}"
                sh 'printenv | sort | grep -E "^(BRANCH_NAME|CHANGE_ID|CHANGE_BRANCH|CHANGE_TARGET)=" || true'
            }
        }

        stage('Verify Tools') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    expression { return env.CHANGE_ID && env.CHANGE_TARGET == 'develop' }
                }
            }
            steps {
                sh 'docker --version'
                sh 'gcloud --version'
                sh 'kubectl version --client'
            }
        }

        stage('Run Tests - API') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    expression { return env.CHANGE_ID && env.CHANGE_TARGET == "develop" }
                }
            }
            steps {
                sh '''
                    docker pull $GO_TEST_IMAGE
                    docker run --rm \
                      -v "$WORKSPACE":/workspace \
                      -w /workspace/services/api-service \
                      $GO_TEST_IMAGE \
                      sh -c "go version && go test ./..."
                '''
            }
        }

        stage('Run Tests - Worker') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    expression { return env.CHANGE_ID && env.CHANGE_TARGET == "develop" }
                }
            }
            steps {
                sh '''
                    docker pull $GO_TEST_IMAGE
                    docker run --rm \
                      -v "$WORKSPACE":/workspace \
                      -w /workspace/services/worker-service \
                      $GO_TEST_IMAGE \
                      sh -c "go version && go test ./..."
                '''
            }
        }

        stage('Build API Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    expression { return env.CHANGE_ID && env.CHANGE_TARGET == 'develop' }
                }
            }
            steps {
                dir('services/api-service') {
                    sh '''
                        docker build \
                          -t $API_IMAGE_FULL:$IMAGE_TAG \
                          -t $API_IMAGE_FULL:latest .
                    '''
                }
            }
        }

        stage('Build Worker Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    expression { return env.CHANGE_ID && env.CHANGE_TARGET == 'develop' }
                }
            }
            steps {
                dir('services/worker-service') {
                    sh '''
                        docker build \
                          -t $WORKER_IMAGE_FULL:$IMAGE_TAG \
                          -t $WORKER_IMAGE_FULL:latest .
                    '''
                }
            }
        }

        stage('GCP Auth') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([file(credentialsId: 'gcp-sa-key', variable: 'GCP_KEY_FILE')]) {
                    sh '''
                        gcloud auth activate-service-account --key-file="$GCP_KEY_FILE"
                        gcloud config set project $PROJECT_ID
                        gcloud auth configure-docker $REGION-docker.pkg.dev -q
                        gcloud container clusters get-credentials $CLUSTER_NAME --region=$REGION
                    '''
                }
            }
        }

        stage('Push Images') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    docker push $API_IMAGE_FULL:$IMAGE_TAG
                    docker push $API_IMAGE_FULL:latest
                    docker push $WORKER_IMAGE_FULL:$IMAGE_TAG
                    docker push $WORKER_IMAGE_FULL:latest
                '''
            }
        }

        stage('Update Kubernetes Deployments') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    kubectl set image deployment/api-service \
                      api-service=$API_IMAGE_FULL:$IMAGE_TAG \
                      -n $NAMESPACE

                    kubectl set image deployment/worker-service \
                      worker-service=$WORKER_IMAGE_FULL:$IMAGE_TAG \
                      -n $NAMESPACE
                '''
            }
        }

        stage('Verify Rollout') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    kubectl rollout status deployment/api-service -n $NAMESPACE
                    kubectl rollout status deployment/worker-service -n $NAMESPACE
                '''
            }
        }

        stage('Skip Notice for Feature/Fix Pushes') {
            when {
                allOf {
                    not { branch 'develop' }
                    not { branch 'main' }
                    expression { return !env.CHANGE_ID }
                }
            }
            steps {
                echo 'This is a non-PR feature/fix branch push. Build/test/deploy stages are intentionally skipped.'
            }
        }
    }

    post {
        always {
            sh 'docker image prune -f || true'
        }
        success {
            echo 'Pipeline completed successfully.'
        }
        failure {
            echo 'Pipeline failed.'
        }
    }
}